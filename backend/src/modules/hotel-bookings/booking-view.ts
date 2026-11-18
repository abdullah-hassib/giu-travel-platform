import { Types } from 'mongoose';
import { cancellationRefund, todayUtc } from '../hotels/stay-rules';
import { HotelBooking } from './schemas/hotel-booking.schema';

type StoredBooking = HotelBooking & { _id: Types.ObjectId };

/** One shape for owners, moderators and admins; it holds no payment or card data. */
export function bookingView(booking: StoredBooking, today = todayUtc()) {
  return {
    id: booking._id.toString(),
    reference: booking.reference ?? null,
    status: booking.status,
    hotel: { id: booking.hotelId.toString(), name: booking.hotelName },
    guestName: booking.guestName,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.nights,
    rooms: booking.rooms.map((room) => ({
      roomId: room.roomId.toString(),
      name: room.name,
      type: room.type,
      adults: room.adults,
      childrenAges: room.childrenAges,
      pricePerNightMinor: room.pricePerNightMinor,
      subtotalMinor: room.subtotalMinor,
    })),
    guests: {
      adults: booking.rooms.reduce((sum, room) => sum + room.adults, 0),
      children: booking.rooms.reduce(
        (sum, room) => sum + room.childrenAges.length,
        0,
      ),
    },
    totalMinor: booking.totalMinor,
    currency: booking.currency,
    holdExpiresAt:
      booking.status === 'Pending Payment' ? booking.holdExpiresAt : null,
    policies: {
      checkInTime: booking.policies.checkInTime,
      checkOutTime: booking.policies.checkOutTime,
      cancellationTiers: booking.policies.cancellationTiers.map((tier) => ({
        daysBefore: tier.daysBefore,
        refundPercent: tier.refundPercent,
      })),
    },
    cancellation: cancellationView(booking, today),
    createdAt: booking.createdAt,
  };
}

/** The refund that was given, or (HTL-21) the refund the guest would get by cancelling today. */
function cancellationView(booking: StoredBooking, today: string) {
  if (booking.status === 'Cancelled') {
    return {
      cancellable: false,
      refundPercent: booking.refundPercent ?? 0,
      refundMinor: booking.refundMinor ?? 0,
      cancelledAt: booking.cancelledAt ?? null,
    };
  }
  if (booking.status === 'Confirmed' && booking.checkIn > today) {
    return {
      cancellable: true,
      ...cancellationRefund(
        booking.totalMinor,
        booking.policies.cancellationTiers,
        booking.checkIn,
        today,
      ),
      cancelledAt: null,
    };
  }
  return null;
}
