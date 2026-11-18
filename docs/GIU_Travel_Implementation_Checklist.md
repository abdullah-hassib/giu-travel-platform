# GIU Travel Planning & Booking Platform — Implementation Checklist

**Audit date:** 2026-11-15 · **Milestone 1 deadline:** 2026-11-20 · **Milestone 2 deadline:** 2026-12-11

**Sources:** Official GIU 14-page PDF (provided in this conversation) · [Official requirements workbook](https://docs.google.com/spreadsheets/d/17WYE0p9EHUn-GUDrtqtCAekhqecOX8H1/edit?gid=874030513) · [Official reference datasets](https://docs.google.com/spreadsheets/d/1SlKUTRqlHuBJAMC-Z-QOZzSrzKpGHT_TgQUI5gVm-BA/edit).

> **Audit scope:** The live private GitHub repository `abdullah-hassib/giu-travel-platform` is empty as of this audit: zero commits/remote branches. An earlier local `giu-travel-backend-foundation.zip` exists with scaffolding but is not pushed or verified. Thus all mandatory business requirements below remain **not done in GitHub**.

> **Current-state note - November 18:** The dated audit and unchecked boxes describe the earlier November 15 snapshot. Requirement statements below are preserved. Use the [current Hassib coverage](../backend/docs/M1_BACKEND_COVERAGE.md) and [completed-slice handoff](../backend/docs/M1_INDEPENDENT_HANDOFF.md) for actual merged work, verification and dependencies.

## Status key

- `[ ]` not implemented/verified in the live repository
- `M2 UI` means primarily a frontend acceptance criterion; its backend counterpart must still be satisfied where relevant
- Optional bonuses are separately excluded; **do not implement** until mandatory functionality is complete.

## 0. Milestone 1 prerequisite / foundation tasks (not separate workbook requirement IDs)
- [ ] Create and protect `main` (stable), `develop` (integration), and feature branches in the actual GitHub repository; publish the reviewed local scaffold to a feature branch only.
- [ ] Commit reproducible NestJS + TypeScript package manifests and npm lockfile; add feature-based controllers/services/models/DTOs incrementally.
- [ ] Install dependencies; run `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` successfully.
- [ ] Configure shared MongoDB Atlas via `MONGODB_URI`; validate required environment variables, `.env.example`, and `.gitignore`; do not commit or publish secrets.
- [ ] Create Mongoose schemas, relationships, indexes and constraints; decide which cross-model transactions, atomic updates and TTL/expiry jobs are required.
- [ ] Correct scaffold contracts: two moderator roles, correct strict booking lifecycle, page-size 10, cookie-based authentication; record approved contracts before dependent implementation.
- [ ] Implement global DTO validation, safe error responses, pagination/filter/sort allowlists, request/response conventions, and clear HTTP status codes.
- [ ] Implement authorization guards and ownership/provider checks before exposing any privileged API routes; use secure httpOnly, Secure, SameSite cookies and server-side refresh-token revocation.
- [ ] Implement and verify Swagger UI + documented request/response schemas; update Swagger security scheme from placeholder Bearer to actual cookie-based authentication.
- [ ] Implement seeding from four official tabs (countries, cities, airports including IANA time zones, attractions); preserve provided IDs and supported currencies.
- [ ] Configure audit, in-app notifications, image uploads, protected static serving, Stripe test mode and FXRatesAPI behind environment configuration; never store card details.
- [ ] Set up admin account seeding securely, using human-approved secret injection and mandatory password change when applicable.
- [ ] Create test fixtures and negative cases for authorization, bad input, hold expiry, concurrent bookings, webhook replay, refunds and access control.
- [ ] Update README, `/docs`, Git issue/PR requirement-ID traceability, and `AI_PROMPTS.txt` for all material AI assistance.
- [ ] Deliver a runnable demo on Swagger with seeded data and actual Atlas connectivity; human review before merging to `main`.

## 1. Official mandatory requirements — 104 items

The acceptance statements below are transcribed from the **Mandatory** tab of the official requirements workbook. Each is an independent trackable task; IDs are authoritative. A checked box should require code, validation, tests and a demonstrable API where backend-applicable.

### Accounts & Admin — 16 requirements

- [ ] **ACC-01** — The system shall allow a guest to register by entering name, unique email, password and a mandatory terms-and-privacy consent checkbox. The password must have at least 8 characters, including at least one letter and one digit. The system shall reject the form with an inline error if the email is invalid or already registered, the password breaks these rules, or consent is not given.
  - Actor: Guest · Complexity: Low
- [ ] **ACC-04** — The system shall allow a registered user, admin or moderator to log in with email and password and land on their role's home page. On failure it shall show a generic "invalid email or password" message. Suspended accounts shall see an "account suspended" message.
  - Actor: Registered User, Admin, Hotel Moderator, Airline Moderator · Complexity: Medium · Dependencies: ACC-01
- [ ] **ACC-05** — After 5 consecutive failed login attempts, the system shall lock the account for 15 minutes and show a lockout message. A successful login resets the counter.
  - Actor: System · Complexity: Medium · Dependencies: ACC-04
- [ ] **ACC-06** — The system shall allow a logged-in user to log out, which clears the authentication cookies and revokes the refresh token on the server. A session with no authenticated request for 30 minutes shall expire and require a new login.
  - Actor: Any logged-in user · Complexity: Medium · Dependencies: ACC-04,ACC-19
- [ ] **ACC-07a** — The system shall allow an admin to reset a user's or moderator's password to a temporary password. The account must set a new password that meets the password rules at its next login.
  - Actor: Admin · Complexity: Low · Dependencies: ACC-04, ACC-14
- [ ] **ACC-08** — The system shall allow a logged-in user to change their password by entering the current password and a new one that meets the rules.
  - Actor: Any logged-in user · Complexity: Low · Dependencies: ACC-04
- [ ] **ACC-09** — The system shall allow any logged-in user to edit name, phone number and preferred currency, saving only if all fields pass validation.
  - Actor: Any logged-in user · Complexity: Low · Dependencies: ACC-04
- [ ] **ACC-10** **[M2 UI emphasis]** — The system shall send a guest who attempts a restricted action (book, review, post) to login and return them to that action afterwards.
  - Actor: Guest · Complexity: Medium · Dependencies: ACC-04
- [ ] **ACC-11** — The system shall restrict access to bookings and private itineraries to their owner, except that admins may view all bookings (ACC-17) and moderators may view bookings for their own hotel or airline (FLT-29, HTL-22). Unauthorised requests shall be rejected (403/404).
  - Actor: System · Complexity: Medium · Dependencies: ACC-04
- [ ] **ACC-12** — The system shall allow a registered user to deactivate their own account after confirmation. Deactivation is blocked while the user has upcoming Confirmed bookings. A deactivated user cannot log in; their posts and public itineraries are hidden, and their comments and reviews are shown as "Deleted user".
  - Actor: Registered User · Complexity: Medium · Dependencies: ACC-04, GEN-11
- [ ] **ACC-13** — The system shall allow an admin to create a hotel or airline moderator account (name, email, role) linked to exactly one hotel or airline, with a temporary password set by the admin. The moderator must change the password on first login.
  - Actor: Admin · Complexity: Medium · Dependencies: ACC-04, FLT-01, HTL-01
- [ ] **ACC-14** — The system shall allow an admin to view a paginated list of all accounts (name, email, role, status, registration date) and to search by name or email and filter by role and status.
  - Actor: Admin · Complexity: Low · Dependencies: ACC-04
- [ ] **ACC-15** — The system shall allow an admin to suspend and reactivate a moderator account (a suspended moderator cannot log in) and, separately, to deactivate and reactivate a hotel or airline. A deactivated provider's listings are hidden from search and cannot be booked; existing Confirmed bookings remain valid. Affected parties receive an in-app notification.
  - Actor: Admin · Complexity: Medium · Dependencies: ACC-13, GEN-01
- [ ] **ACC-16** — The system shall allow an admin to suspend and reactivate registered users (for example, for abusive content). Suspended users cannot log in, their existing bookings remain valid, and their content stays visible unless hidden through GEN-10.
  - Actor: Admin · Complexity: Low · Dependencies: ACC-14
- [ ] **ACC-17** — The system shall allow an admin to view a read-only list of all flight and hotel bookings (reference, user, provider, dates, amount, status), filterable by type, status and date range.
  - Actor: Admin · Complexity: Low · Dependencies: FLT-23, HTL-17
- [ ] **ACC-18** — Admin accounts shall be created by seeding at setup; there is no admin self-registration.
  - Actor: System · Complexity: Low · Dependencies: ACC-04

### Flights — 20 requirements

- [ ] **FLT-01** — The system shall allow an admin to create an airline profile and an airline moderator to edit their airline's profile (name, code, logo).
  - Actor: Admin, Airline Moderator · Complexity: Low · Dependencies: GEN-08
- [ ] **FLT-02** — The system shall provide a predefined, read-only list of airports (IATA code, name, city, country, IANA time zone) loaded at setup. Flight creation and flight search shall accept only airports from this list.
  - Actor: System · Complexity: Low · Dependencies: GEN-12
- [ ] **FLT-03** — The system shall allow an airline moderator to create a flight with flight number, departure and arrival airports, and departure and arrival date-times entered in each airport's local time and stored in UTC. It shall reject identical airports, an arrival not after departure (compared in UTC), a departure in the past, and a duplicate flight number for the same airline on the same departure date.
  - Actor: Airline Moderator · Complexity: Medium · Dependencies: FLT-01, FLT-02
- [ ] **FLT-04** — The system shall allow an airline moderator to define cabin categories per flight from the fixed set {Economy, Premium Economy, Business, First}, each used at most once per flight, with a seat count (whole number, >0), price (>0), free baggage allowance (bag count) and maximum weight (kg) per bag.
  - Actor: Airline Moderator · Complexity: Medium · Dependencies: FLT-03
- [ ] **FLT-05** — The system shall allow an airline moderator to edit departure/arrival times, cabin prices and cabin seat counts of their own Scheduled flights. Airports cannot be changed once the flight has any booking. Seat counts cannot be reduced below seats already booked or held. Price changes do not affect existing bookings. Any time change sends an in-app notification to passengers with Confirmed bookings.
  - Actor: Airline Moderator · Complexity: Medium · Dependencies: FLT-03, FLT-04, GEN-01, FLT-30
- [ ] **FLT-06** — The system shall allow an airline moderator to cancel a Scheduled flight after confirmation. The flight becomes Cancelled and is hidden from search; all its Confirmed bookings become Cancelled with a 100% refund (PAY-03); pending seat holds are released; passengers receive an in-app notification.
  - Actor: Airline Moderator · Complexity: Medium · Dependencies: FLT-23, PAY-03, GEN-01, FLT-30
- [ ] **FLT-08** — The system shall allow an airline moderator to define a price per extra bag (>0) and a maximum number of extra bags per passenger (>=0). Each extra bag has the same maximum weight as the cabin's free baggage allowance.
  - Actor: Airline Moderator · Complexity: Low · Dependencies: FLT-04
- [ ] **FLT-09** — The system shall allow an airline moderator to define cancellation tiers, each with a unique days-before-departure threshold (integer >=0) and a refund percentage (0-100%). The refund for a cancellation uses the tier with the highest threshold not exceeding the days remaining; if no tier applies, the refund is 0%.
  - Actor: Airline Moderator · Complexity: Medium · Dependencies: FLT-01
- [ ] **FLT-11** — The system shall allow a guest or registered user to search flights by selecting a departure airport, arrival airport, departure date (local date at the departure airport) and number of passengers; list Scheduled flights of active airlines on that date whose available seats (total - booked - held) are sufficient; allow the user to select a flight and cabin category to continue; or show "no flights found" when no match exists.
  - Actor: Guest, Registered User · Complexity: High · Dependencies: FLT-02, FLT-03, FLT-04, FLT-22
- [ ] **FLT-12** — The system shall support: (a) round-trip search returning outbound and return options, booked as one booking with two segments, one payment and one reference, and cancelled as a whole using the outbound segment's tier; (b) passenger types adult (12+), child (2-11) and infant (<2): adults and children pay the cabin fare and occupy a seat, infants pay 10% of the fare and occupy no seat, each booking needs at least one adult and no more infants than adults, and the type is validated against the date of birth (FLT-19); (c) an optional cabin-class filter in search.
  - Actor: Guest, Registered User · Complexity: High · Dependencies: FLT-11, FLT-19
- [ ] **FLT-15** — The system shall allow a guest or registered user to filter flight results by an inclusive minimum and maximum price while preserving the other search criteria, show an error if min > max, and sort results by price, duration or departure time.
  - Actor: Guest, Registered User · Complexity: Medium · Dependencies: FLT-11
- [ ] **FLT-17** — The system shall provide a flight details page showing airline, flight number, airports, local departure and arrival times, duration, each cabin category with price, seats remaining and baggage allowance, and the airline's cancellation policy.
  - Actor: Guest, Registered User · Complexity: Low · Dependencies: FLT-11
- [ ] **FLT-19** — The system shall allow a registered user, during booking, to enter each passenger's full name, date of birth and passport/ID number and optionally add extra baggage (bags and weight) per passenger up to the airline's maximum, with any baggage fee added to the booking total.
  - Actor: Registered User · Complexity: Medium · Dependencies: FLT-11, FLT-08
- [ ] **FLT-21** — The system shall show a booking summary (flight, passengers, baggage, total) before payment.
  - Actor: Registered User · Complexity: Low · Dependencies: FLT-19
- [ ] **FLT-22** — When a user proceeds to payment, the system shall atomically reserve the requested seats only if enough remain, creating a booking in Pending Payment status held for 10 minutes. If payment does not succeed within the hold, the booking becomes Expired and the seats are released. Concurrent requests shall never result in more seats booked than available.
  - Actor: System · Complexity: High · Dependencies: FLT-11, GEN-11
- [ ] **FLT-23** — After successful payment, the system shall set the flight booking to Confirmed, convert the held seats into booked seats, generate a unique booking reference, show a confirmation page, send an in-app notification with the booking details, and offer a downloadable e-ticket (PDF).
  - Actor: System · Complexity: Medium · Dependencies: FLT-21, FLT-22, PAY-01, PAY-02, GEN-01
- [ ] **FLT-25** — The system shall allow a registered user to view their flight bookings grouped as Upcoming, Past and Cancelled, showing reference, flight, date, passengers, cabin and status, and to open full details.
  - Actor: Registered User · Complexity: Low · Dependencies: FLT-23
- [ ] **FLT-26** — The system shall allow a registered user to cancel their own Confirmed flight booking any time before departure, after viewing the refund amount computed from the airline's tiers (FLT-09) and confirming. The booking becomes Cancelled, its seats return to inventory and a refund is created (PAY-03). Cancellation after departure is blocked.
  - Actor: Registered User · Complexity: Medium · Dependencies: FLT-23, FLT-09, PAY-03
- [ ] **FLT-29** — The system shall allow an airline moderator to view, per flight, its bookings (reference, passenger names, cabin, seats and status: Confirmed or Cancelled), see seats remaining per category, and view or export the passenger list as CSV.
  - Actor: Airline Moderator · Complexity: Low · Dependencies: FLT-23
- [ ] **FLT-30** — Flights shall have a status of Scheduled, Cancelled or Departed. A flight becomes Departed once its departure time has passed; only Scheduled flights are searchable, editable or bookable.
  - Actor: System · Complexity: Low · Dependencies: FLT-03

### Hotels — 20 requirements

- [ ] **HTL-01** — The system shall allow an admin to create a hotel profile and a hotel moderator to edit their hotel's profile (name, address, city and country, description, photos, star class, amenities).
  - Actor: Admin, Hotel Moderator · Complexity: Low · Dependencies: GEN-08,GEN-12
- [ ] **HTL-02** — The system shall provide a hotel details page showing the hotel profile, photos, amenities, check-in and check-out times, cancellation policy, average rating and reviews, and the available rooms when dates are provided.
  - Actor: Guest, Registered User · Complexity: Low · Dependencies: HTL-01
- [ ] **HTL-03** — The system shall allow a hotel moderator to add a room (an individually bookable unit) with a room number/name unique within the hotel, type, number of beds, maximum occupancy (>=1) and price per night (>0).
  - Actor: Hotel Moderator · Complexity: Low · Dependencies: HTL-01
- [ ] **HTL-04** — The system shall allow a hotel moderator to define non-overlapping date ranges when a room is bookable.
  - Actor: Hotel Moderator · Complexity: Medium · Dependencies: HTL-03
- [ ] **HTL-05** — The system shall allow a hotel moderator to edit a room's beds, occupancy, price and availability. Price changes do not affect existing reservations, and availability cannot be removed for dates with confirmed reservations.
  - Actor: Hotel Moderator · Complexity: Medium · Dependencies: HTL-03
- [ ] **HTL-06** — The system shall allow a hotel moderator to block date ranges for a room and to deactivate or delete a room. Blocking, deactivation or deletion is rejected if it overlaps any Confirmed or Pending Payment reservation. Deactivated rooms are excluded from search; deletion is allowed only for rooms that have never been reserved.
  - Actor: Hotel Moderator · Complexity: Medium · Dependencies: HTL-04, HTL-03
- [ ] **HTL-08** — The system shall allow a hotel moderator to view each room's status for a chosen date range as Available, Booked (with reservation reference) or Blocked.
  - Actor: Hotel Moderator · Complexity: Medium · Dependencies: HTL-04
- [ ] **HTL-09** — The system shall allow a hotel moderator to set the hotel's standard check-in and check-out times, shown on the hotel page and the booking summary.
  - Actor: Hotel Moderator · Complexity: Low · Dependencies: HTL-01
- [ ] **HTL-10** — The system shall allow a hotel moderator to define cancellation tiers, each with a unique days-before-check-in threshold (integer >=0) and a refund percentage (0-100%), applied with the same selection rule as FLT-09.
  - Actor: Hotel Moderator · Complexity: Medium · Dependencies: HTL-01
- [ ] **HTL-11** — The system shall allow a guest or registered user to search hotels by city or country, check-in date, check-out date, number of guests and number of rooms (default 1). It shall list active hotels that have at least that many rooms free for the whole stay whose combined maximum occupancy covers the guests. Check-out must be after check-in, and check-in cannot be in the past.
  - Actor: Guest, Registered User · Complexity: High · Dependencies: HTL-03, HTL-04, HTL-06, HTL-18
- [ ] **HTL-12** — The system shall allow a guest or registered user to filter hotel results by an inclusive minimum and maximum price per night (price of the cheapest qualifying room) and by minimum average rating (1-5; unrated hotels are excluded when a rating filter is set), and sort the results by that price or by rating.
  - Actor: Guest, Registered User · Complexity: Medium · Dependencies: HTL-11, HTL-23
- [ ] **HTL-15** — The system shall allow a guest or registered user to view all of a hotel's rooms that are free for the searched dates, showing type, beds, maximum occupancy, price per night and total stay price, and to select one or more of them to book.
  - Actor: Guest, Registered User · Complexity: Medium · Dependencies: HTL-11
- [ ] **HTL-16** — The system shall allow a registered user to book one or more available rooms in the same hotel for the same dates in one reservation, assigning adults and children (ages 0-17) to each room, with at least one adult per reservation. No room's guests may exceed its maximum occupancy. The total price is the sum over rooms of nights x that room's price at booking time.
  - Actor: Registered User · Complexity: High · Dependencies: HTL-11, HTL-03, HTL-15
- [ ] **HTL-17** — After successful payment, the system shall set the reservation (all its rooms) to Confirmed, generate a unique booking reference, show a confirmation page and send an in-app notification with the reservation details.
  - Actor: System · Complexity: Medium · Dependencies: HTL-16, PAY-01, PAY-02, GEN-01
- [ ] **HTL-18** — When a user proceeds to payment, the system shall hold all selected rooms together for 10 minutes as one Pending Payment reservation. If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, the whole request is rejected and nothing is held. If payment does not succeed within the hold, the reservation becomes Expired and the rooms are released. Dates must satisfy check-out after check-in and check-in not in the past.
  - Actor: System · Complexity: High · Dependencies: HTL-16, GEN-11
- [ ] **HTL-20** — The system shall allow a registered user to view their hotel reservations grouped as Upcoming, Past and Cancelled, showing reference, hotel, rooms, dates, guests, total and status, and to open full details.
  - Actor: Registered User · Complexity: Low · Dependencies: HTL-17
- [ ] **HTL-21** — The system shall allow a registered user to cancel their own Confirmed reservation as a whole before the check-in date, after viewing the refund computed from the hotel's tiers (HTL-10) on the full total. The reservation becomes Cancelled, all its rooms are released for those dates and a refund is created (PAY-03). Partial cancellation is not supported.
  - Actor: Registered User · Complexity: Medium · Dependencies: HTL-17, HTL-10, PAY-03
- [ ] **HTL-22** — The system shall allow a hotel moderator to view reservations for their hotel (guest, dates, status).
  - Actor: Hotel Moderator · Complexity: Low · Dependencies: HTL-17
- [ ] **HTL-23** — A Confirmed reservation becomes Completed once its check-out date has passed. The system shall allow the user to submit one rating (1-5) and an optional review (max 1000 characters) per Completed reservation, regardless of the number of rooms, and later edit or delete it. The hotel's average rating is recalculated accordingly.
  - Actor: Registered User · Complexity: Medium · Dependencies: HTL-17, GEN-11
- [ ] **HTL-24** — The system shall allow a guest or registered user to view a hotel's average rating, number of ratings and reviews (newest first, paginated).
  - Actor: Guest, Registered User · Complexity: Low · Dependencies: HTL-23

### Payments & Policies — 4 requirements

- [ ] **PAY-01** — The system shall allow a registered user to pay for a Pending Payment flight booking or hotel reservation within its hold period using Stripe in test mode (Stripe Elements / PaymentIntents), so that card details never reach the backend. The booking is confirmed only after the backend verifies that the PaymentIntent succeeded (via Stripe webhook). On failure an error is shown and the user may retry until the hold expires; when the hold expires the PaymentIntent is cancelled. Only the Stripe payment ID, amount, currency and status are stored.
  - Actor: Registered User · Complexity: High · Dependencies: FLT-21, HTL-16, FLT-22, HTL-18
- [ ] **PAY-02** — Before payment, the system shall show the provider's policies (airline: cancellation and baggage policies; hotel: cancellation policy and check-in/check-out times) and require an acceptance checkbox. Payment is blocked until accepted, and acceptance is stored with a timestamp.
  - Actor: Registered User · Complexity: Low · Dependencies: FLT-04, FLT-08, FLT-09, HTL-09, HTL-10
- [ ] **PAY-03** — For every cancellation with a positive refund amount (user cancellations per the provider's tiers; provider-initiated cancellations at 100%), the system shall issue a refund through the Stripe Refunds API, record it, and show its status (Pending, Refunded, Failed) on the booking details. The user receives an in-app notification.
  - Actor: System · Complexity: Medium · Dependencies: PAY-01, FLT-09, HTL-10, GEN-01
- [ ] **PAY-04** — All flight and hotel prices, payments and refunds shall use a single platform currency.
  - Actor: System · Complexity: Low

### Itineraries — 15 requirements

- [ ] **ITN-01** — The system shall allow a registered user to create an itinerary with a required title (max 100 characters), one or more countries selected from a predefined list and a start date; edit its title, countries and start date; and delete it after confirmation. It is private by default. When deleted, it disappears from public search, while clones previously made by other users remain unaffected.
  - Actor: Registered User · Complexity: Low · Dependencies: ACC-04, GEN-12
- [ ] **ITN-03** — The system shall allow a user to list their itineraries (title, countries, start date, days and visibility), most recently updated first, and open any itinerary to view its full details.
  - Actor: Registered User · Complexity: Low · Dependencies: ITN-01
- [ ] **ITN-05** — The system shall allow a user to add days to their itinerary and edit each day's city (selected from the predefined city list shared with hotels and airports) and notes. Days are numbered sequentially, their dates derive from the itinerary start date, and an itinerary has at most 60 days.
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-01,GEN-12
- [ ] **ITN-07** — The system shall allow a user to delete a day after confirmation. Remaining days are renumbered, and dates and budget totals are recalculated.
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-05
- [ ] **ITN-08** — The system shall allow a user to move a day to a new position, with days renumbered and dates and groupings recalculated.
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-05
- [ ] **ITN-09** — The system shall require each itinerary day to have a city and shall display consecutive days in the same city as a group, with the group's day count and budget subtotal.
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-05
- [ ] **ITN-10** — The system shall allow a user to add, edit and delete activities for an itinerary day, including name, description, optional time and optional cost.
  - Actor: Registered User · Complexity: Low · Dependencies: ITN-05
- [ ] **ITN-12** — The system shall allow a user to attach images to and remove images from an activity under the shared media-upload rule (GEN-08).
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-10, GEN-08
- [ ] **ITN-14** — The system shall allow a user to add, edit and delete non-negative budget entries for each day across food, accommodation, in-city transport and activities in a selected currency, and show the itinerary's total budget broken down by category and by day. Totals include budget entries, activity costs from ITN-10 (counted under Activities) and intercity transport entries (ITN-16).
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-05, ITN-10, ITN-16
- [ ] **ITN-16** — The system shall allow a user to add, edit and delete a transport cost entry (mode, from-city, to-city, amount, currency, day).
  - Actor: Registered User · Complexity: Low · Dependencies: ITN-05
- [ ] **ITN-18** — The system shall convert all itinerary budget amounts to the user's preferred currency (from the supported currency list) using exchange rates fetched once per day from a configured public exchange-rate API and cached in the database, and show the rate date. If the API is unavailable, the last cached rates are used. Booking prices are not converted (PAY-04).
  - Actor: Registered User, System · Complexity: Medium · Dependencies: ITN-14, ACC-09, PAY-04
- [ ] **ITN-20** — The system shall allow a user to set an itinerary's visibility to Public or Private. Public itineraries appear in shared search and are read-only to other users. Setting Private removes them immediately.
  - Actor: Registered User · Complexity: Low · Dependencies: ITN-01
- [ ] **ITN-21** — The system shall allow a guest or registered user to search public itineraries by keyword matching title, country or city; filter results by duration (min/max days) and by country or city; and view a public itinerary read-only with author, days, activities and budget. A registered user may clone it; the clone includes all days, activities and budgets, is private, credits the original author and is independent of the original.
  - Actor: Guest, Registered User · Complexity: Medium · Dependencies: ITN-20
- [ ] **ITN-25** — The system shall allow a user to pick a city group in their itinerary and view hotels available for that group's dates (check-in = date of the group's first day, check-out = the day after its last day) and a guest count and number of rooms they enter, reusing hotel search (HTL-11).
  - Actor: Registered User · Complexity: Medium · Dependencies: ITN-09, HTL-11
- [ ] **ITN-26** — The system shall allow a user to search one-way or round-trip flights from a chosen origin airport to any airport in the city of the itinerary's first day. The outbound date defaults to the start date and the return date to the last day's date; the search reuses FLT-11 and FLT-12.
  - Actor: Registered User · Complexity: Medium · Dependencies: FLT-02, FLT-11, FLT-12, ITN-05

### Blog — 11 requirements

- [ ] **BLG-01** — The system shall allow a registered user to create a post with a required title and body, optional tags and images, and save it as Draft or Publish. Published posts appear in the author's blog and in search.
  - Actor: Registered User · Complexity: Low · Dependencies: ACC-04
- [ ] **BLG-02** — The system shall allow a guest or registered user to browse a paginated list of published posts filterable by tag, and open a post page showing title, author, date, body, tags, images, like count and comments. Liking, commenting and reporting require login (ACC-10).
  - Actor: Guest, Registered User · Complexity: Low · Dependencies: BLG-01, BLG-08
- [ ] **BLG-03** — The system shall allow a user to list their own posts, including drafts, with title, status, date, like count and comment count.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-01
- [ ] **BLG-04** — The system shall allow an author to edit and delete their own posts.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-01
- [ ] **BLG-05** — The system shall allow a user to comment on a published post (non-empty, max 500 characters), shown in chronological order.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-01
- [ ] **BLG-06** — The system shall allow a user to like a post once and remove the like, showing the like count.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-01
- [ ] **BLG-07** — The system shall allow a user to edit and delete their own comments.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-05
- [ ] **BLG-08** — The system shall allow an author to add up to 5 tags (max 30 characters each) to a post and edit them later. Tags are searchable and clickable to list matching posts.
  - Actor: Registered User · Complexity: Low · Dependencies: BLG-01
- [ ] **BLG-09** — The system shall allow a guest or registered user to search published posts by keyword in title, tags or author name, showing title, author, date and excerpt, or "no results". Results are ordered by interaction score (likes + comments) descending, with newest first as a tie-breaker.
  - Actor: Guest, Registered User · Complexity: Medium · Dependencies: BLG-01
- [ ] **BLG-10** — The system shall allow an author to attach images to a post under the shared media-upload rule (GEN-08) and remove them.
  - Actor: Registered User · Complexity: Medium · Dependencies: BLG-01, GEN-08
- [ ] **BLG-12** — The system shall provide a public author page showing the author's name, join date, published posts and public itineraries.
  - Actor: Guest, Registered User · Complexity: Low · Dependencies: BLG-01, ITN-20

### Cross-cutting — 18 requirements

- [ ] **GEN-01** — The system shall show in-app notifications (unread count, notification list, mark as read) for booking confirmation, cancellation and refund, flight schedule change, and account or provider suspension.
  - Actor: System · Complexity: Medium
- [ ] **GEN-02** **[M2 UI emphasis]** — The system shall show field-level validation messages on all forms.
  - Actor: System · Complexity: Low
- [ ] **GEN-03** **[M2 UI emphasis]** — The system shall ask for confirmation before destructive actions (delete, cancel).
  - Actor: System · Complexity: Low
- [ ] **GEN-04** **[M2 UI emphasis]** — The system shall show friendly empty states when a list or search has no results.
  - Actor: System · Complexity: Low
- [ ] **GEN-05** — The system shall paginate every list longer than 10 rows (page size 10).
  - Actor: System · Complexity: Low
- [ ] **GEN-06** — The system shall show flight times in each airport's local time zone.
  - Actor: System · Complexity: Medium · Dependencies: FLT-02, FLT-03
- [ ] **GEN-07** — The system shall keep an audit log of admin actions (suspensions, deletions).
  - Actor: System · Complexity: Low · Dependencies: ACC-15, ACC-16, GEN-10
- [ ] **GEN-08** — The system shall accept image uploads in JPG or PNG format, up to 5 MB each, with up to 5 images per post, activity or hotel and 1 logo per airline, stored on the server and served by URL. Uploads outside these limits are rejected with an error.
  - Actor: System · Complexity: Medium
- [ ] **GEN-09** — The system shall allow a registered user to report a post, comment, review or itinerary with a reason, at most once per item.
  - Actor: Registered User · Complexity: Low · Dependencies: ACC-04
- [ ] **GEN-10** — The system shall allow an admin to view the list of open reports and resolve each by dismissing it, hiding the content or deleting it, and to hide or delete any post, comment, review or itinerary directly. Hidden content is visible only to its author and admins.
  - Actor: Admin · Complexity: Medium · Dependencies: GEN-09
- [ ] **GEN-11** — Flight bookings and hotel reservations shall follow the lifecycle Pending Payment -> Confirmed -> Completed, with Pending Payment -> Expired (hold timeout) and Confirmed -> Cancelled (user or provider cancellation) as the only other transitions.
  - Actor: System · Complexity: Medium · Dependencies: FLT-22, HTL-18, PAY-01
- [ ] **GEN-12** — The system shall seed reference data at setup: airports, cities, countries and supported currencies.
  - Actor: System · Complexity: Low
- [ ] **GEN-13** — All validation, business rules and authorisation shall be enforced by the backend regardless of frontend checks, and passwords shall be stored only as salted hashes.
  - Actor: System · Complexity: Medium
- [ ] **ACC-19** — The system shall not store authentication tokens or user credentials in localStorage, sessionStorage or any other JavaScript-accessible storage. Access and refresh tokens shall be issued as httpOnly, Secure, SameSite cookies, and the frontend shall obtain the current user from an /auth/me endpoint.
  - Actor: System · Complexity: Medium · Dependencies: ACC-04, ACC-06
- [ ] **GEN-14** **[M2 UI emphasis]** — The system shall provide a clear and organized information architecture, with logically grouped content, balanced spacing, correctly structured menus, and intuitive navigation. Users shall be able to return to previous pages or cancel actions where applicable without losing unrelated data.
  - Actor: System · Complexity: Medium
- [ ] **GEN-15** **[M2 UI emphasis]** — The system shall provide an intuitive, easy-to-learn interface with clearly visible actions, understandable labels, and efficient workflows that minimize unnecessary steps and user effort.
  - Actor: System · Complexity: Medium
- [ ] **GEN-16** **[M2 UI emphasis]** — The system shall provide clear feedback for user actions, including loading, success, and error states. The interface shall be responsive across desktop, tablet, and mobile screen sizes, prevent common input errors, and provide understandable error messages and recovery options.
  - Actor: System · Complexity: Medium · Dependencies: GEN-02, GEN-03, GEN-04
- [ ] **GEN-17** **[M2 UI emphasis]** — The system shall maintain a consistent color palette, typography, spacing, alignment, and component styling across all pages. Menus, buttons, forms, tables, and other UI elements shall be visually consistent, properly aligned, and professionally designed.
  - Actor: System · Complexity: Medium

## 2. Milestone 1 REST API inventory — 110 mandatory endpoint entries

These are the required endpoints listed in §8 of the PDF; 9 optional endpoint entries are intentionally omitted. Supporting-service endpoints for notifications, reporting, media, FX and audit may need additional routes, as permitted by §8.10.

### 8.1 Authentication and Accounts

- [ ] `POST /api/auth/register` — ACC-01
- [ ] `POST /api/auth/login` — ACC-04, ACC-05
- [ ] `POST /api/auth/logout` — ACC-06
- [ ] `POST /api/admin/users/:id/reset-password` — ACC-07a
- [ ] `PATCH /api/auth/change-password` — ACC-08
- [ ] `GET /api/auth/me` — ACC-04, ACC-19
- [ ] `GET /api/users/me` — ACC-11
- [ ] `PATCH /api/users/me` — ACC-09
- [ ] `DELETE /api/users/me` — ACC-12

### 8.2 Administration

- [ ] `POST /api/admin/moderators` — ACC-13
- [ ] `GET /api/admin/accounts` — ACC-14
- [ ] `PATCH /api/admin/accounts/:id/suspend` — ACC-15, ACC-16
- [ ] `PATCH /api/admin/accounts/:id/reactivate` — ACC-15, ACC-16
- [ ] `PATCH /api/admin/providers/:type/:id/deactivate` — ACC-15
- [ ] `PATCH /api/admin/providers/:type/:id/reactivate` — ACC-15
- [ ] `GET /api/admin/bookings` — ACC-17
- [ ] `GET /api/admin/reports` — GEN-09, GEN-10
- [ ] `PATCH /api/admin/reports/:id` — GEN-10
- [ ] `DELETE /api/admin/content/:type/:id` — GEN-10
- [ ] `GET /api/admin/audit-logs` — GEN-07

### 8.3 Airlines, Flights, and Flight Inventory

- [ ] `POST /api/airlines` — FLT-01
- [ ] `GET /api/airlines/:id` — FLT-01
- [ ] `PATCH /api/airlines/:id` — FLT-01
- [ ] `GET /api/airports` — FLT-02
- [ ] `POST /api/flights` — FLT-03
- [ ] `GET /api/flights/search` — FLT-11, FLT-12, FLT-15
- [ ] `GET /api/flights/:id` — FLT-17
- [ ] `PATCH /api/flights/:id` — FLT-05
- [ ] `POST /api/flights/:id/cancel` — FLT-06
- [ ] `POST /api/flights/:id/cabins` — FLT-04
- [ ] `PATCH /api/flights/:id/cabins/:cabinId` — FLT-04, FLT-05
- [ ] `PUT /api/airlines/:id/baggage-policy` — FLT-04, FLT-08
- [ ] `PUT /api/airlines/:id/cancellation-policy` — FLT-09
- [ ] `GET /api/flights/:id/bookings` — FLT-29
- [ ] `GET /api/flights/:id/passengers/export` — FLT-29

### 8.4 Flight Booking

- [ ] `POST /api/flight-bookings/hold` — FLT-22
- [ ] `POST /api/flight-bookings` — FLT-19, FLT-21
- [ ] `GET /api/flight-bookings` — FLT-25
- [ ] `GET /api/flight-bookings/:id` — FLT-25
- [ ] `POST /api/flight-bookings/:id/cancel` — FLT-26
- [ ] `GET /api/flight-bookings/:id/e-ticket` — FLT-23

### 8.5 Hotels and Rooms

- [ ] `POST /api/hotels` — HTL-01
- [ ] `GET /api/hotels/search` — HTL-11, HTL-12
- [ ] `GET /api/hotels/:id` — HTL-02
- [ ] `PATCH /api/hotels/:id` — HTL-01
- [ ] `POST /api/hotels/:id/rooms` — HTL-03
- [ ] `PATCH /api/hotels/:id/rooms/:roomId` — HTL-05
- [ ] `DELETE /api/hotels/:id/rooms/:roomId` — HTL-06
- [ ] `GET /api/hotels/:id/rooms/available` — HTL-15
- [ ] `POST /api/hotels/:id/rooms/:roomId/availability` — HTL-04
- [ ] `PATCH /api/hotels/:id/rooms/:roomId/availability` — HTL-05, HTL-06
- [ ] `GET /api/hotels/:id/availability` — HTL-08
- [ ] `PUT /api/hotels/:id/policies` — HTL-09, HTL-10
- [ ] `GET /api/hotels/:id/reservations` — HTL-22

### 8.6 Hotel Booking and Reviews

- [ ] `POST /api/hotel-bookings` — HTL-16, HTL-18
- [ ] `GET /api/hotel-bookings` — HTL-20
- [ ] `GET /api/hotel-bookings/:id` — HTL-20
- [ ] `POST /api/hotel-bookings/:id/cancel` — HTL-21
- [ ] `POST /api/hotel-bookings/:id/review` — HTL-23
- [ ] `PATCH /api/reviews/:id` — HTL-23
- [ ] `DELETE /api/reviews/:id` — HTL-23
- [ ] `GET /api/hotels/:id/reviews` — HTL-24

### 8.7 Payments and Refunds

- [ ] `GET /api/bookings/:type/:id/policies` — PAY-02
- [ ] `POST /api/bookings/:type/:id/accept-policies` — PAY-02
- [ ] `POST /api/payments` — PAY-01
- [ ] `POST /api/payments/:id/retry` — PAY-01
- [ ] `GET /api/payments/:id` — PAY-01
- [ ] `POST /api/payments/webhook` — PAY-01
- [ ] `GET /api/refunds/:id` — PAY-03

### 8.8 Itineraries

- [ ] `POST /api/itineraries` — ITN-01
- [ ] `GET /api/itineraries` — ITN-03
- [ ] `GET /api/itineraries/:id` — ITN-03
- [ ] `PATCH /api/itineraries/:id` — ITN-01, ITN-20
- [ ] `DELETE /api/itineraries/:id` — ITN-01
- [ ] `POST /api/itineraries/:id/days` — ITN-05
- [ ] `PATCH /api/itineraries/:id/days/:dayId` — ITN-05
- [ ] `DELETE /api/itineraries/:id/days/:dayId` — ITN-07
- [ ] `PATCH /api/itineraries/:id/days/reorder` — ITN-08
- [ ] `POST /api/itineraries/:id/days/:dayId/activities` — ITN-10
- [ ] `PATCH /api/activities/:id` — ITN-10
- [ ] `DELETE /api/activities/:id` — ITN-10
- [ ] `POST /api/activities/:id/images` — ITN-12, GEN-08
- [ ] `DELETE /api/activities/:id/images/:imageId` — ITN-12
- [ ] `POST /api/itineraries/:id/days/:dayId/budgets` — ITN-14
- [ ] `PATCH /api/budgets/:id` — ITN-14
- [ ] `DELETE /api/budgets/:id` — ITN-14
- [ ] `POST /api/itineraries/:id/transport-costs` — ITN-16
- [ ] `PATCH /api/transport-costs/:id` — ITN-16
- [ ] `DELETE /api/transport-costs/:id` — ITN-16
- [ ] `GET /api/itineraries/:id/budget-summary` — ITN-14, ITN-18
- [ ] `GET /api/itineraries/public/search` — ITN-20, ITN-21
- [ ] `GET /api/itineraries/public/:id` — ITN-21
- [ ] `POST /api/itineraries/:id/clone` — ITN-21
- [ ] `GET /api/itineraries/:id/hotels` — ITN-25
- [ ] `GET /api/itineraries/:id/flights` — ITN-26

### 8.9 Blog

- [ ] `POST /api/posts` — BLG-01
- [ ] `GET /api/posts` — BLG-02, BLG-09
- [ ] `GET /api/posts/:id` — BLG-02
- [ ] `GET /api/posts/mine` — BLG-03
- [ ] `PATCH /api/posts/:id` — BLG-04, BLG-08
- [ ] `DELETE /api/posts/:id` — BLG-04
- [ ] `POST /api/posts/:id/comments` — BLG-05
- [ ] `PATCH /api/comments/:id` — BLG-07
- [ ] `DELETE /api/comments/:id` — BLG-07
- [ ] `POST /api/posts/:id/like` — BLG-06
- [ ] `DELETE /api/posts/:id/like` — BLG-06
- [ ] `POST /api/posts/:id/images` — BLG-10, GEN-08
- [ ] `DELETE /api/posts/:id/images/:imageId` — BLG-10
- [ ] `GET /api/tags/:tag/posts` — BLG-08
- [ ] `GET /api/authors/:id` — BLG-12

## 3. Cross-module integration tests and evaluation gates

- [ ] Register/login/logout via secure cookies; lockout at five failures for 15 minutes; idle expiry 30 minutes; suspended and deactivated accounts denied.
- [ ] Admin, traveler, airline moderator and hotel moderator cannot cross access boundaries; each moderator manages exactly one assigned provider.
- [ ] Flight local time interpreted using each airport IANA time zone, stored UTC, formatted locally on response.
- [ ] Concurrent flight holds for final seat never oversell; expiry after exactly 10 minutes releases capacity.
- [ ] Round-trip flight booking has one booking/reference/payment and two segments; infant occupancy and fare rules correct.
- [ ] Hotel date-overlap checks reject conflicting rooms and atomically hold multiple selected rooms as a single reservation.
- [ ] Hold expiry and failed Stripe payment never confirm a booking; signed webhook success confirms exactly once; replay is idempotent.
- [ ] Cancellation tiers select the correct highest threshold <= days remaining; provider cancellation forces 100% refund.
- [ ] Completed hotel stay can be reviewed once per reservation; other users cannot review; ratings recalculate.
- [ ] Budget totals include entries + activity costs + intercity costs; daily FX cache and fallback work.
- [ ] Private itineraries remain private; public clone is independent, private, and attributed.
- [ ] Public blog search, comments, likes, report/hide/delete and audit permissions enforced.
- [ ] Image limits (JPG/PNG, <=5 MB, resource-specific counts) applied on server.
- [ ] All list endpoints use page size 10 for lists >10 and validate allowed filters and sort fields.
- [ ] Swagger and actual Atlas-enabled NestJS startup tested; repo Git history and AI prompt log reviewed.

## 4. Milestone 2 frontend work (begins after M1 API contract freeze)

- [ ] Create Next.js / React / TypeScript frontend; choose justified server/client rendering per page.
- [ ] Public guest pages, route protection, /auth/me cookie-driven session handling, signup/login/account settings.
- [ ] Flight/hotel search, filters, details, guest/passenger forms, booking summaries, cancellation previews and e-ticket download.
- [ ] Stripe Elements/payment UX (no card details through NestJS) and payment/refund status UI.
- [ ] Private itinerary editor, city groups, days, activities, budgets, FX display, public search, clone workflow.
- [ ] Blog posts, editor, author pages, comments, likes, reporting and review pages.
- [ ] Airline/hotel moderator dashboards and admin moderation/users/bookings/audit screens.
- [ ] In-app notification UI, unread count, marking as read, friendly empty/loading/error states, confirmation dialogs.
- [ ] Responsive desktop/tablet/mobile, navigation hierarchy, consistent typography/spacing, accessibility and SEO where appropriate.
- [ ] Integrated end-to-end smoke tests and screenshots for evaluation.

## 5. Explicitly excluded bonuses — 11 items

- [ ] **NOT PLANNED — ACC-02**: The system shall send a verification link by email after registration and block booking until the email is verified.
- [ ] **NOT PLANNED — ACC-07**: The system shall allow a user who forgot their password to request a reset link by email; the link expires after 30 minutes, is single-use, is invalidated by a newer request, and the response does not reveal whether the email exists.
- [ ] **NOT PLANNED — GEN-01-B**: The system shall also send the GEN-01 notifications (plus moderator invitations) by email via SMTP, using a test inbox in development.
- [ ] **NOT PLANNED — FLT-27**: The system shall allow a registered user to change a Confirmed flight booking's date or flight (same route and cabin), paying any fare difference via Stripe or receiving a refund of a lower fare, subject to seat availability.
- [ ] **NOT PLANNED — FLT-28**: The system shall allow seat selection.
- [ ] **NOT PLANNED — HTL-26**: The system shall allow a hotel moderator to reply to a review.
- [ ] **NOT PLANNED — ITN-27**: The system shall allow booked flights and hotels to be linked to itinerary days, feeding the budget.
- [ ] **NOT PLANNED — ITN-28**: The system shall allow a user to export or print an itinerary as PDF.
- [ ] **NOT PLANNED — BLG-13**: The system shall allow an author to attach an itinerary to a post.
- [ ] **NOT PLANNED — BON-01**: The system shall provide an admin analytics dashboard showing bookings and revenue per provider over a selected period.
- [ ] **NOT PLANNED — BON-02**: The system shall allow a registered user to save hotels and public itineraries to a favourites list and view it.

## 6. Readiness and review

- [ ] Team agrees on role names (`Registered User`, `Admin`, `Airline Moderator`, `Hotel Moderator`) and one-provider assignment semantics.
- [ ] Team agrees on exact GEN-11 booking states and FLT-30 flight states; rejects extra unsupported states.
- [ ] Team chooses one platform currency (PAY-04), using supported currencies from Countries.csv.
- [ ] Team signs off on how MongoDB Atlas atomic updates/transactions and release jobs ensure consistency.
- [ ] Team signs off on Stripe webhook signature verification, retry/idempotency and refund audit trail.
- [ ] Team assigns each requirement group to a real developer, links GitHub issues by requirement ID, and reviews all PRs against `develop`.
- [ ] Final Swagger acceptance run tests all mandatory endpoints; only reviewed release enters `main`.
