# Itinerary hotel search (ITN-25)

`GET /api/itineraries/:id/hotels?dayId=<owned-day-id>&guests=2&rooms=1` requires an active traveler session and ownership of the itinerary, including when it is public. Staff-only roles receive 403; foreign/missing itinerary or day receives 404. Responses use no-store.

Choose any day within a consecutive city group. The server derives its city, check-in on the first day and exclusive check-out on the day after the last day. Repeated visits to the same city remain separate groups. Selection is recalculated after start-date, day order, city and deletion changes. Date overflow or a past stay is rejected with 400. Searching does not mutate the itinerary, hold rooms or create a booking.

The endpoint calls MK's existing `HotelsService.search`, preserving its active provider/room rules, whole-stay availability, blocking/holds, combined occupancy, filters, sorting and ten-row pagination. No hotel search logic or teammate source is duplicated.

Query accepts `dayId`, required `guests`, `rooms` (default 1), `page` (default 1), `minPriceMinor`, `maxPriceMinor`, `minRating`, `sortBy` and `order`, using the hotel's DTO validation. Prices are USD cents. Invalid/null/malformed/unknown input is rejected; client city/country/check-in/check-out overrides are not accepted.

Response is `{ selection: { cityId, firstDayNumber, dayCount, checkIn, checkOut }, data, meta }`. Hotel rows and pagination are the actual hotel search result; Swagger describes their schemas and query defaults explicitly.

To demonstrate: log in as the itinerary owner, create at least one day, take its day ID from the returned view and call this endpoint with guests/rooms. Searchable results require actual hotel rooms with matching availability; an empty result is valid. A different traveler's session cannot search using that itinerary ID.

`itinerary-hotel-search.e2e-spec.ts` uses real itinerary/hotel/booking modules with a disposable replica set. It compares the result to direct hotel search and covers consecutive/nonconsecutive groups, edits/reordering/deletion, real holds/expiry/capacity, provider deactivation, filters/sorting/pagination, ownership, validation, calendar overflow and Swagger. No external service, private configuration, shared Atlas or credential is required. ITN-26 flight search remains dependent on Adham's implementation.
