import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  BookingKind,
  BookingPaymentAdapters,
  BookingPaymentSnapshot,
} from './booking-payment.adapter';
import {
  bookingPolicySnapshot,
  bookingPolicyToken,
} from './booking-policy-snapshot';
import { BookingPolicyReviewDto } from './dto/booking-policies.dto';
import {
  PolicyAcceptance,
  PolicyAcceptanceDocument,
} from './schemas/policy-acceptance.schema';

@Injectable()
export class BookingPoliciesService {
  constructor(
    private readonly adapters: BookingPaymentAdapters,
    @InjectModel(PolicyAcceptance.name)
    private readonly acceptances: Model<PolicyAcceptance>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private view(
    snapshot: BookingPaymentSnapshot,
    acceptance: PolicyAcceptanceDocument | null,
  ): BookingPolicyReviewDto {
    const policyToken = bookingPolicyToken(snapshot);
    const accepted =
      acceptance?.policyToken === policyToken &&
      acceptance.userId.toString() === snapshot.userId;
    return {
      bookingType: snapshot.kind,
      bookingId: snapshot.id,
      providerId: snapshot.providerId,
      amountMinor: snapshot.amountMinor,
      currency: snapshot.currency,
      holdExpiresAt: snapshot.holdExpiresAt.toISOString(),
      policies: snapshot.policies,
      policyToken,
      canAccept:
        snapshot.state === 'Pending Payment' &&
        snapshot.holdExpiresAt.getTime() > Date.now(),
      accepted,
      acceptedAt: accepted ? acceptance.acceptedAt.toISOString() : null,
    };
  }

  async requireAccepted(
    snapshot: BookingPaymentSnapshot,
    session: ClientSession,
  ): Promise<PolicyAcceptanceDocument> {
    const accepted = await this.acceptances
      .findOne({
        kind: snapshot.kind,
        bookingId: snapshot.id,
        userId: snapshot.userId,
        policyToken: bookingPolicyToken(snapshot),
      })
      .session(session)
      .exec();
    if (
      !accepted ||
      accepted.acceptedAt.getTime() >= snapshot.holdExpiresAt.getTime()
    ) {
      throw new ConflictException(
        'Accept the current provider policies before payment',
      );
    }
    return accepted;
  }

  async review(
    userId: string,
    kind: BookingKind,
    bookingId: string,
  ): Promise<BookingPolicyReviewDto> {
    const snapshot = bookingPolicySnapshot(
      await this.adapters.forKind(kind).getOwned(userId, bookingId),
      kind,
      bookingId,
      userId,
    );
    const acceptance = await this.acceptances
      .findOne({ kind, bookingId: snapshot.id, userId })
      .exec();
    return this.view(snapshot, acceptance);
  }

  async accept(
    userId: string,
    kind: BookingKind,
    bookingId: string,
    token: string,
  ): Promise<BookingPolicyReviewDto> {
    return this.connection.transaction(async (session) => {
      const snapshot = bookingPolicySnapshot(
        await this.adapters
          .forKind(kind)
          .getOwnedForUpdate(userId, bookingId, session),
        kind,
        bookingId,
        userId,
      );
      if (
        snapshot.state !== 'Pending Payment' ||
        snapshot.holdExpiresAt.getTime() <= Date.now()
      ) {
        throw new ConflictException(
          'Policies can only be accepted during an active payment hold',
        );
      }
      const policyToken = bookingPolicyToken(snapshot);
      if (token !== policyToken)
        throw new ConflictException(
          'Booking or policies changed; review them again',
        );
      const existing = await this.acceptances
        .findOne({ kind, bookingId: snapshot.id })
        .session(session)
        .exec();
      if (
        existing?.policyToken === policyToken &&
        existing.userId.toString() === userId
      )
        return this.view(snapshot, existing);
      const acceptance = await this.acceptances
        .findOneAndUpdate(
          { kind, bookingId: snapshot.id },
          {
            $set: {
              userId: new Types.ObjectId(userId),
              providerId: new Types.ObjectId(snapshot.providerId),
              bookingRevision: snapshot.revision,
              policyToken,
              amountMinor: snapshot.amountMinor,
              currency: snapshot.currency,
              policies: snapshot.policies,
              holdExpiresAt: snapshot.holdExpiresAt,
              acceptedAt: new Date(),
            },
          },
          { session, upsert: true, new: true, runValidators: true },
        )
        .orFail()
        .exec();
      return this.view(snapshot, acceptance);
    });
  }
}
