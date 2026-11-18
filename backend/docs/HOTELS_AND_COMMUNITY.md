# Hotels, bookings, reviews, blog and moderation (MK, Milestone 1)

Branch `feature/mk-hotels-bookings-community`. Requirement IDs follow the official workbook.

## What is implemented

| Area | Requirements | Routes |
| --- | --- | --- |
| Hotel profiles, photos, status | HTL-01, HTL-02, ACC-15 (hotel side), GEN-08 | `POST /api/hotels`, `GET/PATCH /api/hotels/:id`, `PATCH /api/hotels/:id/status`, `POST/DELETE /api/hotels/:id/images` |
| Rooms, availability, blocking | HTL-03..HTL-06, HTL-08 | `/api/hotels/:id/rooms[/:roomId[/availability]]`, `GET /api/hotels/:id/availability` |
| Policies | HTL-09, HTL-10 | `PUT /api/hotels/:id/policies` |
| Search and free rooms | HTL-11, HTL-12, HTL-15 | `GET /api/hotels/search`, `GET /api/hotels/:id/rooms/available` |
| Bookings | HTL-16..HTL-18, HTL-20..HTL-22, GEN-11, ACC-11 | `/api/hotel-bookings[/:id[/cancel]]`, `GET /api/hotels/:id/reservations` |
| Reviews | HTL-23, HTL-24 | `POST /api/hotel-bookings/:id/review`, `PATCH/DELETE /api/reviews/:id`, `GET /api/hotels/:id/reviews` |
| Blog | BLG-01..BLG-10, BLG-12, ACC-12 | `/api/posts` (+ `mine`, comments, like, images), `/api/comments/:id`, `/api/tags/:tag/posts`, `/api/authors/:id` |
| Reports and moderation | GEN-09, GEN-10, GEN-07 events | `POST /api/reports`, `GET /api/admin/reports`, `PATCH /api/admin/reports/:id`, `PATCH /api/admin/content/:type/:id/hide`, `DELETE /api/admin/content/:type/:id` |
| Image uploads | GEN-08 | `GET /api/media/:imageId` serves files saved by the routes above |

All lists return 10 rows per page as `{ data, meta }`. Every route is in Swagger at `/api/docs` with its requirement IDs.

## Rules worth knowing

- **Dates** are `YYYY-MM-DD` in UTC. A range `{ from, to }` means the nights from `from` up to, not including, `to`, exactly like check-in/check-out. Back-to-back stays therefore do not overlap.
- **Money** is USD cents (`...Minor` fields), matching the platform currency (PAY-04).
- **No double booking.** A booking transaction first writes every selected room document. Two requests for the same room write-conflict, MongoDB retries the loser, and the loser then sees the winner's hold and gets 409. Any failure aborts the whole transaction, so a multi-room request is all-or-nothing. Blocking, deactivating, deleting and payment confirmation write the room the same way. The e2e tests fire simultaneous requests at one room and expect exactly one 201.
- **Holds** last 10 minutes. An expired hold stops blocking its rooms immediately; its status is shown as `Expired` on the next read. A Confirmed stay becomes `Completed` once its check-out date has passed.
- **Cancellation** refund = the tier with the highest `daysBefore` not above the days left before check-in, applied to the full total (0% if no tier applies). Tiers are saved with the booking, so later policy edits do not change it.
- **Moderators** can manage only the hotel in their `moderator_assignments` record. Other people's bookings return 404.
- **Deactivated accounts:** their posts are hidden; their comments and reviews show "Deleted user". Suspended accounts' content stays visible (ACC-16).

## Swagger demo

1. Log in as an admin and `POST /api/hotels` (city must belong to the country).
2. Assign a hotel moderator to it with Hassib's `POST /api/admin/moderators` (ACC-13). On a branch without that endpoint, insert `{ userId, providerType: 'hotel', providerId }` into `moderator_assignments`.
3. As the moderator: `POST /api/hotels/:id/rooms`, `POST .../rooms/:roomId/availability`, `PUT /api/hotels/:id/policies`.
4. As a traveler: `GET /api/hotels/search?cityId=cairo&checkIn=...&checkOut=...&guests=2`, then `POST /api/hotel-bookings`. The booking is `Pending Payment` for 10 minutes.
5. The moderator sees it in `GET /api/hotels/:id/reservations` and `GET /api/hotels/:id/availability`.
6. Blog: `POST /api/posts` with `status: "published"`, comment, like, then `POST /api/reports`; as admin `GET /api/admin/reports` and `PATCH /api/admin/reports/:id` with `{ "action": "hide" }`.

## Team handoffs

**Hassib (payments, administration)**
- `HotelPaymentAdapter` (exported by `HotelBookingsModule`) implements the approved `BookingSettlementAdapter` shape: `getOwned`, `getOwnedForUpdate`, `linkPayment`, `confirmPayment`, `expirePayment`, with `kind = 'hotel'`. Once the payment branch is merged, import `HotelBookingsModule` in `PaymentsModule` and add the adapter to `BOOKING_PAYMENT_ADAPTERS`. Bookings are confirmed only through it (HTL-17); there is no client confirm route.
- Cancellation currently records `refundPercent`/`refundMinor` on the booking and in a `hotel_booking.cancelled` event. After the refunds branch is merged, call `RefundsService.enqueueCancellation({ paymentId, bookingId, userId, amountMinor: refundMinor, reason: 'user_cancellation' }, session)` inside `HotelBookingsService.cancel`'s transaction.
- ACC-13 hotel provider adapter: `HotelsService.lockExisting(hotelId, session)` returns `{ id, kind: 'hotel' }` or throws 404.
- ACC-15: `HotelsService.setActive(adminId, hotelId, active)` (also exposed as `PATCH /api/hotels/:id/status`).
- ACC-12 / ACC-17: hotel bookings live in `hotel_bookings`; upcoming Confirmed ones are `{ userId, status: 'Confirmed', checkOut: { $gte: today } }`.
- ITN-12: import `MediaUploadsModule` and use `MediaService.saveImage(file)` / `removeImage(id)` with `MAX_IMAGES_PER_ITEM`; `@ImageUpload()` adds the multipart handling and Swagger body.

**Omar (notifications, audit)** - events are written to `event_outbox` in the same transaction as the change, with the `admin_outbox` envelope (`id, type, version, occurredAt, correlationId, actorId, payload, status: 'pending'`). Deduplicate on `id`, then set `status: 'delivered'`.

| Type | Payload |
| --- | --- |
| `hotel_booking.confirmed` | bookingId, reference, userId, hotelId, hotelName, checkIn, checkOut, rooms, totalMinor, currency |
| `hotel_booking.cancelled` | bookingId, reference, userId, hotelId, paymentId, reason, refundPercent, refundMinor, currency |
| `hotel.deactivated` / `hotel.reactivated` | hotelId |
| `moderation.content_hidden` / `moderation.content_deleted` | targetType, targetId, authorId |
| `moderation.report_dismissed` | reportId, targetType, targetId |

**Kuwaity (reference data)** - hotel `cityId`/`countryCode` use the official reference identifiers and the city must belong to the country.

## Known limits

- Hiding a reported itinerary makes it private (only its owner sees it, ITN-20). A dedicated hidden flag would need a field in the itinerary module.
- HTL-08 reports nights outside every bookable range as `Unavailable`, next to Available/Booked/Blocked.
- Hotel search filters in memory per city/country, which is fine for this project's data size.
