# Administration booking reads (ACC-17, hotel integration)

`GET /api/admin/bookings?type=hotel` requires an active administrator session and completion of any mandatory password change. Returns no-store and a sanitized `{ data, meta }` list, ten rows per page. Optional filters are `status`, `from`, `to` and `page`; dates filter the booking's check-in/start date inclusively. Reversed or malformed ranges, unsupported state/type, operators, extra fields and unsafe page values return 400.

Rows contain id/type, nullable reference, saved user/provider identity snapshots, stay dates, authoritative USD total, effective status and creation timestamp. They omit security data, payment links, policy snapshots, room/child details and arbitrary stored fields. Sorting is createdAt descending then ObjectId descending, with rows/count produced by one aggregation facet.

The hotel projection consumes MK's actual `HotelBooking` schema in a separate Hassib-owned read service. Expired holds and completed stays are derived for display/filtering using the existing hotel date rules; this endpoint does not mutate booking state, inventory or payment records. Authentication may renew its own session normally.

Only the supplied hotel integration is available. `type=flight` or omitted type returns a documented 503 until Adham supplies flight reads and combined pagination can be integrated. It never returns a hotel-only list as though it contained all bookings. This is partial ACC-17 coverage, not completion of the combined requirement.

Swagger demo: log in as an admin, call with type=hotel, filter by Confirmed and an inclusive start-date range, then request page 2. A guest receives 401 and a traveler/moderator receives 403. A valid empty hotel result has total=0/totalPages=0. The flight/combined dependency remains explicit.

`admin-bookings.e2e-spec.ts` uses actual administration/auth models and a disposable MongoDB database. Cases cover role/inactive/forced-password authorization, positive projection, stable paging/counts, inclusive date/state filtering, effective state without writes, missing integration behavior, invalid queries and Swagger. No private environment file, shared database or external service is used.
