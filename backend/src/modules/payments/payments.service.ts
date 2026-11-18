import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { createHash, randomUUID } from 'node:crypto';
import { BookingKind, BookingPaymentAdapters } from './booking-payment.adapter';
import { BookingPoliciesService } from './booking-policies.service';
import {
  bookingPolicySnapshot,
  bookingPolicyToken,
} from './booking-policy-snapshot';
import { assertStripePayableMoney } from './platform-money';
import {
  GatewayIntent,
  StripeTestGateway,
  VerifiedGatewayEvent,
} from './stripe-test.gateway';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { PaymentEvent } from './schemas/payment-event.schema';
import { RefundsService } from '../refunds/refunds.service';
import { PaymentAttemptDto, PaymentViewDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(PaymentEvent.name)
    private readonly events: Model<PaymentEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly adapters: BookingPaymentAdapters,
    private readonly policies: BookingPoliciesService,
    private readonly gateway: StripeTestGateway,
    private readonly refunds: RefundsService,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  private async view(payment: PaymentDocument): Promise<PaymentViewDto> {
    return {
      id: payment._id.toString(),
      bookingId: payment.bookingId.toString(),
      bookingType: payment.kind,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
      fulfillment: payment.fulfillment,
      stripePaymentId: payment.stripeIntentId ?? null,
      holdExpiresAt: payment.holdExpiresAt.toISOString(),
      policiesAcceptedAt: payment.acceptedAt.toISOString(),
      refunds: await this.refunds.forPayment(payment._id.toString()),
    };
  }

  private async owned(userId: string, id: string): Promise<PaymentDocument> {
    const payment = await this.payments.findOne({ _id: id, userId }).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async getOwned(userId: string, id: string): Promise<PaymentViewDto> {
    return this.view(await this.owned(userId, id));
  }

  private async bookingAccount(
    userId: string,
    session: ClientSession,
    requireActive = false,
  ): Promise<User['status']> {
    const account = await this.users
      .findOneAndUpdate(
        { _id: userId, ...(requireActive && { status: 'active' }) },
        { $inc: { bookingFence: 1 } },
        { session, new: true },
      )
      .select('status')
      .lean()
      .exec();
    if (requireActive && !account)
      throw new ForbiddenException('An active account is required for payment');
    return account?.status ?? 'deactivated';
  }

  private reference(
    payment: PaymentDocument,
    intentId = payment.stripeIntentId,
  ) {
    if (!intentId)
      throw new ConflictException('Payment intent has not been linked');
    return {
      paymentId: payment._id.toString(),
      intentId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    };
  }

  private async prepare(
    userId: string,
    kind: BookingKind,
    bookingId: string,
  ): Promise<PaymentDocument> {
    const adapter = this.adapters.forSettlement(kind);
    return this.connection.transaction(async (session) => {
      const snapshot = bookingPolicySnapshot(
        await adapter.getOwnedForUpdate(userId, bookingId, session),
        kind,
        bookingId,
        userId,
      );
      if (
        snapshot.state !== 'Pending Payment' ||
        snapshot.holdExpiresAt.getTime() <= Date.now()
      )
        throw new ConflictException('Payment requires an active booking hold');
      assertStripePayableMoney(snapshot.amountMinor, snapshot.currency);
      await this.bookingAccount(userId, session, true);
      const acceptance = await this.policies.requireAccepted(snapshot, session);
      const existing = await this.payments
        .findOne({ kind, bookingId })
        .session(session)
        .exec();
      if (existing) {
        if (
          existing.policyToken !== acceptance.policyToken ||
          existing.userId.toString() !== userId ||
          existing.fulfillment !== 'pending'
        ) {
          throw new ConflictException(
            'The linked payment no longer matches this payable booking',
          );
        }
        await adapter.linkPayment(
          userId,
          bookingId,
          existing._id.toString(),
          session,
        );
        return existing;
      }
      const [payment] = await this.payments.create(
        [
          {
            kind,
            bookingId: new Types.ObjectId(bookingId),
            userId: new Types.ObjectId(userId),
            providerId: new Types.ObjectId(snapshot.providerId),
            amountMinor: snapshot.amountMinor,
            currency: snapshot.currency,
            bookingRevision: snapshot.revision,
            policyToken: acceptance.policyToken,
            policies: acceptance.policies,
            acceptedAt: acceptance.acceptedAt,
            holdExpiresAt: snapshot.holdExpiresAt,
            status: 'creating',
            fulfillment: 'pending',
            nextAttemptAt: snapshot.holdExpiresAt,
          },
        ],
        { session },
      );
      await adapter.linkPayment(
        userId,
        bookingId,
        payment._id.toString(),
        session,
      );
      return payment;
    });
  }

  private async lease(
    id: string,
  ): Promise<{ payment: PaymentDocument; token: string }> {
    const token = randomUUID();
    const payment = await this.payments
      .findOneAndUpdate(
        {
          _id: id,
          $or: [
            { leaseUntil: { $exists: false } },
            { leaseUntil: { $lte: new Date() } },
          ],
        },
        {
          $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) },
        },
        { new: true },
      )
      .exec();
    if (!payment)
      throw new ConflictException(
        'Payment operation is already in progress; retry shortly',
      );
    return { payment, token };
  }

  private async release(id: string, token: string): Promise<void> {
    await this.payments
      .updateOne(
        { _id: id, leaseToken: token },
        { $unset: { leaseToken: 1, leaseUntil: 1 } },
      )
      .exec();
  }

  private async bindIntent(
    payment: PaymentDocument,
    token: string,
    intent: GatewayIntent,
  ): Promise<void> {
    if (
      intent.paymentId !== payment._id.toString() ||
      intent.amountMinor !== payment.amountMinor ||
      intent.currency !== payment.currency
    )
      throw new BadGatewayException('Payment gateway response mismatch');
    if (payment.status === 'succeeded' && intent.status !== 'succeeded')
      throw new BadGatewayException(
        'Payment gateway returned a regressed status',
      );
    const result = await this.payments
      .updateOne(
        {
          _id: payment._id,
          leaseToken: token,
          $or: [
            { stripeIntentId: { $exists: false } },
            { stripeIntentId: intent.id },
          ],
        },
        { $set: { stripeIntentId: intent.id, status: intent.status } },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictException(
        'Payment operation was superseded or linked to another intent',
      );
  }

  async create(
    userId: string,
    kind: BookingKind,
    bookingId: string,
  ): Promise<PaymentAttemptDto> {
    const payment = await this.prepare(userId, kind, bookingId);
    return this.attempt(userId, payment._id.toString());
  }

  async retry(userId: string, id: string): Promise<PaymentAttemptDto> {
    const payment = await this.owned(userId, id);
    if (payment.fulfillment === 'confirmed')
      return { payment: await this.view(payment), clientSecret: null };
    if (
      payment.fulfillment === 'expired' ||
      payment.holdExpiresAt.getTime() <= Date.now()
    ) {
      await this.expire(id);
      throw new ConflictException('Booking hold has expired');
    }
    await this.prepare(userId, payment.kind, payment.bookingId.toString());
    return this.attempt(userId, id);
  }

  private async attempt(
    userId: string,
    id: string,
  ): Promise<PaymentAttemptDto> {
    await this.owned(userId, id);
    const { payment, token } = await this.lease(id);
    try {
      if (payment.fulfillment === 'confirmed')
        return { payment: await this.view(payment), clientSecret: null };
      if (
        payment.fulfillment === 'expired' ||
        payment.holdExpiresAt.getTime() <= Date.now()
      ) {
        await this.expireLocked(payment, token);
        throw new ConflictException('Booking hold has expired');
      }
      const intent = payment.stripeIntentId
        ? await this.gateway.retrieveIntent(this.reference(payment))
        : await this.gateway.createIntent({
            paymentId: id,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
          });
      await this.bindIntent(payment, token, intent);
      const current = await this.payments.findById(id).orFail().exec();
      if (current.holdExpiresAt.getTime() <= Date.now()) {
        await this.expireLocked(current, token);
        throw new ConflictException('Booking hold has expired');
      }
      if (intent.status === 'canceled')
        throw new ConflictException('The payment intent has been canceled');
      if (intent.status !== 'succeeded' && !intent.clientSecret)
        throw new BadGatewayException(
          'Stripe did not return an Elements client secret',
        );
      // Only signed webhook settlement can consume the booking hold.
      return {
        payment: await this.view(current),
        clientSecret:
          intent.status === 'succeeded' ? null : intent.clientSecret,
      };
    } finally {
      await this.release(id, token);
    }
  }

  private async applyIntent(
    id: string,
    token: string,
    intent: GatewayIntent,
    eventId?: string,
  ): Promise<void> {
    await this.connection.transaction(async (session) => {
      const payment = await this.payments
        .findOne({ _id: id, leaseToken: token })
        .session(session)
        .exec();
      if (!payment)
        throw new ConflictException('Payment operation was superseded');
      if (payment.stripeIntentId && payment.stripeIntentId !== intent.id)
        throw new BadRequestException(
          'Event does not match the linked payment intent',
        );
      if (
        intent.paymentId !== id ||
        intent.amountMinor !== payment.amountMinor ||
        intent.currency !== payment.currency ||
        (payment.status === 'succeeded' && intent.status !== 'succeeded')
      )
        throw new BadGatewayException('Payment gateway response mismatch');
      const adapter = this.adapters.forSettlement(payment.kind);
      const snapshot = bookingPolicySnapshot(
        await adapter.getOwnedForUpdate(
          payment.userId.toString(),
          payment.bookingId.toString(),
          session,
        ),
        payment.kind,
        payment.bookingId.toString(),
        payment.userId.toString(),
      );
      if (bookingPolicyToken(snapshot) !== payment.policyToken)
        throw new ConflictException(
          'The immutable payment quote was changed by the booking adapter',
        );
      payment.stripeIntentId = intent.id;
      payment.status = intent.status;
      const expired =
        payment.fulfillment === 'expired' ||
        snapshot.state === 'Expired' ||
        payment.holdExpiresAt.getTime() <= Date.now();
      if (payment.fulfillment === 'pending') {
        const status = await this.bookingAccount(
          payment.userId.toString(),
          session,
        );
        if (
          !expired &&
          status === 'deactivated' &&
          intent.status === 'succeeded'
        ) {
          // Preserve the approved hold deadline/adapter contract. The verified
          // event remains durable and the existing worker refunds at expiry.
          throw new ConflictException(
            'Account deactivated; payment awaits booking hold expiry and reconciliation',
          );
        }
      }
      if (payment.fulfillment !== 'confirmed' && expired) {
        if (snapshot.state === 'Pending Payment')
          await adapter.expirePayment(
            payment.userId.toString(),
            payment.bookingId.toString(),
            id,
            session,
          );
        else if (snapshot.state !== 'Expired')
          throw new ConflictException(
            'Booking state does not match expired payment settlement',
          );
        payment.fulfillment = 'expired';
      } else if (
        payment.fulfillment === 'pending' &&
        intent.status === 'succeeded' &&
        eventId
      ) {
        const outcome = await adapter.confirmPayment(
          payment.userId.toString(),
          payment.bookingId.toString(),
          id,
          session,
        );
        if (outcome !== 'Confirmed' && outcome !== 'Expired')
          throw new BadGatewayException(
            'Booking adapter returned an invalid settlement result',
          );
        payment.fulfillment = outcome === 'Confirmed' ? 'confirmed' : 'expired';
      }
      payment.nextAttemptAt =
        payment.fulfillment === 'expired' ? new Date() : payment.holdExpiresAt;
      if (payment.fulfillment === 'expired' && intent.status === 'canceled')
        payment.expiryResolvedAt = new Date();
      await payment.save({ session });
      if (payment.fulfillment === 'expired' && intent.status === 'succeeded') {
        await this.refunds.enqueueLate(id, session);
        payment.expiryResolvedAt = new Date();
        await payment.save({ session });
      }
      if (eventId)
        await this.events
          .updateOne(
            { eventId },
            { $set: { status: 'processed', processedAt: new Date() } },
            { session },
          )
          .exec();
    });
  }

  private async expireLocked(
    payment: PaymentDocument,
    token: string,
  ): Promise<void> {
    const id = payment._id.toString();
    await this.connection.transaction(async (session) => {
      const current = await this.payments
        .findOne({ _id: id, leaseToken: token })
        .session(session)
        .orFail()
        .exec();
      if (current.fulfillment === 'confirmed') return;
      if (
        current.holdExpiresAt.getTime() > Date.now() &&
        current.fulfillment !== 'expired'
      )
        return;
      const adapter = this.adapters.forSettlement(current.kind);
      const snapshot = bookingPolicySnapshot(
        await adapter.getOwnedForUpdate(
          current.userId.toString(),
          current.bookingId.toString(),
          session,
        ),
        current.kind,
        current.bookingId.toString(),
        current.userId.toString(),
      );
      if (snapshot.state === 'Pending Payment')
        await adapter.expirePayment(
          current.userId.toString(),
          current.bookingId.toString(),
          id,
          session,
        );
      else if (snapshot.state !== 'Expired')
        throw new ConflictException(
          'Only unfulfilled booking holds may expire',
        );
      current.fulfillment = 'expired';
      await current.save({ session });
    });
    const current = await this.payments.findById(id).orFail().exec();
    if (current.fulfillment !== 'expired') return;
    // Replay the same create key if its original response was lost, then reconcile.
    const intent = current.stripeIntentId
      ? await this.gateway.retrieveIntent(this.reference(current))
      : await this.gateway.createIntent({
          paymentId: id,
          amountMinor: current.amountMinor,
          currency: current.currency,
        });
    await this.bindIntent(current, token, intent);
    if (intent.status === 'succeeded' || intent.status === 'canceled') {
      await this.applyIntent(id, token, intent);
    } else {
      const canceled = await this.gateway.cancelIntent(
        this.reference(current, intent.id),
      );
      await this.applyIntent(id, token, canceled);
    }
  }

  async expire(id: string): Promise<void> {
    const { payment, token } = await this.lease(id);
    try {
      await this.expireLocked(payment, token);
    } catch (error) {
      await this.payments
        .updateOne(
          { _id: id, leaseToken: token },
          { $set: { nextAttemptAt: new Date(Date.now() + 60000) } },
        )
        .exec();
      throw error;
    } finally {
      await this.release(id, token);
    }
  }

  private async eventRecord(event: VerifiedGatewayEvent) {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(event))
      .digest('hex');
    let stored;
    try {
      stored = await this.events
        .findOneAndUpdate(
          { eventId: event.eventId },
          {
            $setOnInsert: {
              eventId: event.eventId,
              type: event.type,
              fingerprint,
              occurredAt: event.createdAt,
              resourceId: event.resourceId ?? undefined,
              paymentId: event.paymentId ?? undefined,
              refundId: event.refundId ?? undefined,
              resourceType: event.resourceType ?? undefined,
              nextAttemptAt: new Date(),
              status: 'pending',
            },
          },
          { new: true, upsert: true, runValidators: true },
        )
        .exec();
    } catch (error: unknown) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
      stored = await this.events.findOne({ eventId: event.eventId }).exec();
    }
    if (!stored || stored.fingerprint !== fingerprint)
      throw new BadRequestException(
        'Stripe event identity was reused with different data',
      );
    return stored;
  }

  async webhook(rawBody: Buffer, signature: string | undefined): Promise<void> {
    const event = this.gateway.verifyWebhook(rawBody, signature);
    const stored = await this.eventRecord(event);
    await this.processStoredEvent(stored);
  }

  private async processStoredEvent(event: PaymentEvent): Promise<void> {
    if (event.status !== 'pending') return;
    try {
      await this.applyStoredEvent(event);
    } catch (error) {
      await this.events
        .updateOne(
          { eventId: event.eventId, status: 'pending' },
          { $set: { nextAttemptAt: new Date(Date.now() + 60000) } },
        )
        .exec();
      throw error;
    }
  }

  /** Only records persisted after SDK signature verification enter this path. */
  private async applyStoredEvent(event: PaymentEvent): Promise<void> {
    // Compatibility with pending records written before durable replay fields.
    const resourceType =
      event.resourceType ??
      (event.type.startsWith('payment_intent.')
        ? 'payment_intent'
        : event.type.startsWith('refund.')
          ? 'refund'
          : undefined);
    const ignore = () =>
      this.events
        .updateOne(
          { eventId: event.eventId },
          { $set: { status: 'ignored', processedAt: new Date() } },
        )
        .exec();
    if (!resourceType || !event.resourceId) {
      await ignore();
      return;
    }
    if (resourceType === 'refund') {
      const refundId = await this.refunds.findForEvent(
        event.resourceId,
        event.refundId ?? null,
      );
      if (!refundId) {
        await ignore();
        return;
      }
      await this.refunds.sync(refundId, event.resourceId);
      await this.events
        .updateOne(
          { eventId: event.eventId },
          { $set: { status: 'processed', processedAt: new Date() } },
        )
        .exec();
      return;
    }
    const payment =
      (await this.payments
        .findOne({ stripeIntentId: event.resourceId })
        .exec()) ??
      (event.paymentId
        ? await this.payments.findById(event.paymentId).exec()
        : null);
    if (!payment) {
      await ignore();
      return;
    }
    if (payment.stripeIntentId && payment.stripeIntentId !== event.resourceId)
      throw new BadRequestException(
        'Stripe event does not match the stored payment',
      );
    const { payment: locked, token } = await this.lease(payment._id.toString());
    try {
      const intent = await this.gateway.retrieveIntent(
        this.reference(locked, event.resourceId),
      );
      await this.applyIntent(
        payment._id.toString(),
        token,
        intent,
        event.eventId,
      );
    } finally {
      await this.release(payment._id.toString(), token);
    }
  }

  async runDue(): Promise<void> {
    const pendingEvents = await this.events
      .find({
        status: 'pending',
        $or: [
          { nextAttemptAt: { $lte: new Date() } },
          { nextAttemptAt: { $exists: false } },
        ],
      })
      .sort({ nextAttemptAt: 1, _id: 1 })
      .limit(50)
      .exec();
    for (const event of pendingEvents) {
      try {
        await this.processStoredEvent(event);
      } catch {
        /* Verified metadata stays durable; failures back off without raw bodies. */
      }
    }
    const due = await this.payments
      .find({
        fulfillment: { $ne: 'confirmed' },
        holdExpiresAt: { $lte: new Date() },
        expiryResolvedAt: { $exists: false },
        nextAttemptAt: { $lte: new Date() },
      })
      .sort({ holdExpiresAt: 1 })
      .limit(50)
      .exec();
    for (const payment of due) {
      try {
        await this.expire(payment._id.toString());
      } catch {
        /* Durable unresolved records retain their retry deadline. */
      }
    }
  }
}
