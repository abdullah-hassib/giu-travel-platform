import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Payment } from '../payments/schemas/payment.schema';
import { StripeTestGateway } from '../payments/stripe-test.gateway';
import { Refund, RefundDocument } from './schemas/refund.schema';
import { RefundOutbox } from './schemas/refund-outbox.schema';

export interface AuthorizedCancellationRefund {
  paymentId: string;
  bookingId: string;
  userId: string;
  amountMinor: number;
  reason: 'user_cancellation' | 'provider_cancellation';
}

@Injectable()
export class RefundsService {
  constructor(
    @InjectModel(Refund.name) private readonly refunds: Model<Refund>,
    @InjectModel(Payment.name) private readonly payments: Model<Payment>,
    @InjectModel(RefundOutbox.name)
    private readonly outbox: Model<RefundOutbox>,
    @InjectConnection() private readonly connection: Connection,
    private readonly gateway: StripeTestGateway,
  ) {}

  private view(refund: RefundDocument) {
    return {
      id: refund._id.toString(),
      paymentId: refund.paymentId.toString(),
      bookingId: refund.bookingId.toString(),
      bookingType: refund.kind,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
    };
  }

  async getOwned(userId: string, id: string) {
    const refund = await this.refunds.findOne({ _id: id, userId }).exec();
    if (!refund) throw new NotFoundException('Refund not found');
    return this.view(refund);
  }

  async forPayment(paymentId: string) {
    return (await this.refunds.find({ paymentId }).sort({ _id: 1 }).exec()).map(
      (refund) => this.view(refund),
    );
  }

  private async notify(
    refund: RefundDocument,
    session: ClientSession,
  ): Promise<void> {
    const id = `refund:${refund._id}:${refund.status}`;
    await this.outbox
      .updateOne(
        { id },
        {
          $setOnInsert: {
            id,
            type: 'refund.status_changed',
            version: 1,
            occurredAt: new Date().toISOString(),
            correlationId: refund._id.toString(),
            payload: {
              recipientUserId: refund.userId.toString(),
              refundId: refund._id.toString(),
              paymentId: refund.paymentId.toString(),
              bookingId: refund.bookingId.toString(),
              bookingType: refund.kind,
              amountMinor: refund.amountMinor,
              currency: refund.currency,
              refundStatus: refund.status,
            },
            status: 'pending',
          },
        },
        { session, upsert: true, runValidators: true },
      )
      .exec();
  }

  /** Called inside the owning cancellation transaction after authorization/tier calculation. */
  async enqueueCancellation(
    input: AuthorizedCancellationRefund,
    session: ClientSession,
  ): Promise<RefundDocument | null> {
    if (
      [input.paymentId, input.bookingId, input.userId].some(
        (id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id),
      ) ||
      !['user_cancellation', 'provider_cancellation'].includes(input.reason)
    )
      throw new BadRequestException(
        'Invalid cancellation refund authorization',
      );
    return this.enqueue(
      input.paymentId,
      input.amountMinor,
      input.reason,
      session,
      { bookingId: input.bookingId, userId: input.userId },
    );
  }

  async enqueueLate(
    paymentId: string,
    session: ClientSession,
  ): Promise<RefundDocument | null> {
    const payment = await this.payments
      .findById(paymentId)
      .session(session)
      .orFail()
      .exec();
    return this.enqueue(
      paymentId,
      payment.amountMinor,
      'late_payment',
      session,
    );
  }

  private async enqueue(
    paymentId: string,
    amountMinor: number,
    reason: Refund['reason'],
    session: ClientSession,
    owner?: { bookingId: string; userId: string },
  ): Promise<RefundDocument | null> {
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0)
      throw new BadRequestException('Invalid authorized refund amount');
    // All refund reservations for a payment serialize through this document write.
    const payment = await this.payments
      .findOneAndUpdate(
        {
          _id: paymentId,
          status: 'succeeded',
          stripeIntentId: { $exists: true },
        },
        { $inc: { refundFence: 1 } },
        { session, new: true },
      )
      .exec();
    if (!payment || !payment.stripeIntentId)
      throw new ConflictException(
        'Refund requires a verified succeeded payment',
      );
    if (
      owner &&
      (owner.bookingId.toLowerCase() !== payment.bookingId.toString() ||
        owner.userId.toLowerCase() !== payment.userId.toString())
    ) {
      throw new ConflictException('Cancellation does not match the payment');
    }
    if (
      (reason === 'late_payment' && payment.fulfillment !== 'expired') ||
      (reason !== 'late_payment' && payment.fulfillment !== 'confirmed')
    ) {
      throw new ConflictException(
        'Refund reason does not match booking fulfillment',
      );
    }
    if (
      reason === 'provider_cancellation' &&
      amountMinor !== payment.amountMinor
    )
      throw new BadRequestException(
        'Provider cancellations require a full refund',
      );
    if (amountMinor === 0) return null;
    const operationKey =
      reason === 'late_payment'
        ? `late:${payment._id}`
        : `cancel:${payment.kind}:${payment.bookingId}`;
    const existing = await this.refunds
      .findOne({ operationKey })
      .session(session)
      .exec();
    if (existing) {
      if (existing.amountMinor !== amountMinor || existing.reason !== reason)
        throw new ConflictException(
          'Cancellation refund authorization changed',
        );
      return existing;
    }
    const [reserved] = await this.refunds
      .aggregate<{ total: number }>([
        {
          $match: {
            paymentId: payment._id,
            status: { $in: ['Pending', 'Refunded'] },
          },
        },
        { $group: { _id: null, total: { $sum: '$amountMinor' } } },
      ])
      .session(session)
      .exec();
    if (amountMinor > payment.amountMinor - (reserved?.total ?? 0))
      throw new ConflictException(
        'Refund exceeds the unreserved payment amount',
      );
    const [refund] = await this.refunds.create(
      [
        {
          paymentId: payment._id,
          bookingId: payment.bookingId,
          userId: payment.userId,
          kind: payment.kind,
          stripeIntentId: payment.stripeIntentId,
          paidAmountMinor: payment.amountMinor,
          amountMinor,
          currency: payment.currency,
          operationKey,
          reason,
          status: 'Pending',
          nextAttemptAt: new Date(),
        },
      ],
      { session },
    );
    await this.notify(refund, session);
    return refund;
  }

  async sync(id: string, expectedStripeId?: string): Promise<void> {
    const token = randomUUID();
    const refund = await this.refunds
      .findOneAndUpdate(
        {
          _id: id,
          $or: [
            { leaseUntil: { $lte: new Date() } },
            { leaseUntil: { $exists: false } },
          ],
        },
        {
          $set: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) },
        },
        { new: true },
      )
      .exec();
    if (!refund)
      throw new ConflictException(
        'Refund reconciliation is already in progress',
      );
    try {
      if (
        expectedStripeId &&
        refund.stripeRefundId &&
        refund.stripeRefundId !== expectedStripeId
      )
        throw new BadRequestException(
          'Refund event does not match the stored refund',
        );
      if (refund.status === 'Refunded') return;
      const input = {
        paymentId: refund.paymentId.toString(),
        intentId: refund.stripeIntentId,
        amountMinor: refund.paidAmountMinor,
        currency: refund.currency,
        refundId: refund._id.toString(),
        refundAmountMinor: refund.amountMinor,
      };
      const stripeId = refund.stripeRefundId ?? expectedStripeId;
      const result = stripeId
        ? await this.gateway.retrieveRefund(input, stripeId)
        : await this.gateway.createRefund(input);
      await this.connection.transaction(async (session) => {
        const current = await this.refunds
          .findOne({ _id: id, leaseToken: token })
          .session(session)
          .exec();
        if (!current)
          throw new ConflictException('Refund operation was superseded');
        current.stripeRefundId = result.id;
        const changed = current.status !== result.status;
        current.status = result.status;
        current.nextAttemptAt = new Date(Date.now() + 60000);
        await current.save({ session });
        if (changed) await this.notify(current, session);
      });
    } catch (error: unknown) {
      if (
        error instanceof HttpException &&
        error.getStatus() === 400 &&
        !expectedStripeId
      ) {
        await this.connection.transaction(async (session) => {
          const failed = await this.refunds
            .findOneAndUpdate(
              { _id: id, leaseToken: token, status: 'Pending' },
              { $set: { status: 'Failed' } },
              { new: true, session },
            )
            .exec();
          if (failed) await this.notify(failed, session);
        });
      } else {
        await this.refunds
          .updateOne(
            { _id: id, leaseToken: token },
            { $set: { nextAttemptAt: new Date(Date.now() + 60000) } },
          )
          .exec();
        throw error;
      }
    } finally {
      await this.refunds
        .updateOne(
          { _id: id, leaseToken: token },
          { $unset: { leaseToken: 1, leaseUntil: 1 } },
        )
        .exec();
    }
  }

  async findForEvent(
    resourceId: string,
    refundId: string | null,
  ): Promise<string | null> {
    const refund =
      (await this.refunds.findOne({ stripeRefundId: resourceId }).exec()) ??
      (refundId && Types.ObjectId.isValid(refundId)
        ? await this.refunds.findById(refundId).exec()
        : null);
    return refund?._id.toString() ?? null;
  }

  async runDue(): Promise<void> {
    const due = await this.refunds
      .find({ status: 'Pending', nextAttemptAt: { $lte: new Date() } })
      .sort({ nextAttemptAt: 1 })
      .limit(50)
      .exec();
    for (const refund of due) {
      try {
        await this.sync(refund._id.toString());
      } catch {
        /* Durable Pending records retain their retry deadline. */
      }
    }
  }
}
