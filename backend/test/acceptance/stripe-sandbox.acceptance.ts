/** Opt-in external acceptance. Default invocation prints a plan without credentials/network. */
import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Request, Response, NextFunction } from 'express';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, Model } from 'mongoose';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import Stripe from 'stripe';
import request from 'supertest';
import { HttpErrorFilter } from '../../src/common/filters/http-error.filter';
import { AdministrationModule } from '../../src/modules/administration/administration.module';
import { AuditLog } from '../../src/modules/audit-logging/schemas/audit-log.schema';
import { hashPassword } from '../../src/modules/auth/security/password';
import { DomainEventConsumer } from '../../src/modules/domain-events/domain-event-consumer';
import { CommittedOutboxConsumer } from '../../src/modules/domain-events/committed-outbox-consumer';
import { FlightBooking } from '../../src/modules/flight-bookings/schemas/flight-booking.schema';
import { FlightsModule } from '../../src/modules/flights/flights.module';
import { Flight } from '../../src/modules/flights/schemas/flight.schema';
import { HotelBooking } from '../../src/modules/hotel-bookings/schemas/hotel-booking.schema';
import { configurePaymentBodyParsers } from '../../src/modules/payments/payment-body-parsers';
import { PaymentsModule } from '../../src/modules/payments/payments.module';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { Payment } from '../../src/modules/payments/schemas/payment.schema';
import { PaymentEvent } from '../../src/modules/payments/schemas/payment-event.schema';
import { Refund } from '../../src/modules/refunds/schemas/refund.schema';
import { RefundsService } from '../../src/modules/refunds/refunds.service';
import { seedOfficialReferences } from '../../src/modules/reference-data/reference-seed';
import { User } from '../../src/modules/users/schemas/user.schema';

const config = new ConfigService({ NODE_ENV: 'test' });
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: config }],
  exports: [ConfigService],
})
class AcceptanceConfiguration {}
type Agent = ReturnType<typeof request.agent>;
type Json = Record<string, unknown>;
interface PaidAttempt {
  id: string;
  stripePaymentId: string;
  amountMinor: number;
}
class AcceptanceFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function check(condition: unknown, code: string): asserts condition {
  if (!condition) throw new AcceptanceFailure(code);
}
function object(value: unknown): Json {
  check(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'unexpected_response_shape',
  );
  return value as Json;
}
function string(value: unknown): string {
  check(typeof value === 'string', 'unexpected_string_field');
  return value;
}
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const plan = {
  database: 'new disposable loopback MongoDB replica set',
  stripeMode: 'test only',
  paymentIntents: 3,
  successfulPayments: 2,
  fullRefunds: 2,
  declinedRetry: true,
  forcedDeadlineExpiry: true,
  webhooks: 'actual Stripe CLI snapshot deliveries; no generated signatures',
  credentials: 'runtime only; never printed or persisted by this script',
};

async function main(): Promise<void> {
  const fixtureOnly = process.argv.includes('--verify-fixtures');
  check(
    !(fixtureOnly && process.argv.includes('--execute')),
    'choose_one_execution_mode',
  );
  if (!fixtureOnly && !process.argv.includes('--execute')) {
    process.stdout.write(
      JSON.stringify({
        mode: 'plan_only',
        credentialAccess: false,
        stripeNetwork: false,
        plan,
      }) + '\n',
    );
    return;
  }
  let key: string | undefined,
    signingSecret: string | undefined,
    stripe!: Stripe;
  if (!fixtureOnly) {
    check(
      process.argv.includes('--listener-stopped'),
      'stop_other_local_webhook_listeners_first',
    );
    // Credentials are accessed only after explicit execution/isolated-listener opt-in.
    key = process.env.STRIPE_SECRET_KEY;
    signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
    check(
      key && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(key),
      'valid_test_secret_key_required',
    );
    check(
      signingSecret && /^whsec_[A-Za-z0-9]+$/.test(signingSecret),
      'webhook_signing_secret_required',
    );
    stripe = new Stripe(key, { maxNetworkRetries: 1, timeout: 5000 });
    config.set('STRIPE_SECRET_KEY', key);
    config.set('STRIPE_WEBHOOK_SECRET', signingSecret);
  }
  const mediaRoot = mkdtempSync(join(tmpdir(), 'giu-stripe-acceptance-'));
  config.set('MEDIA_UPLOAD_DIR', mediaRoot);
  let app: INestApplication | undefined,
    mongo: MongoMemoryReplSet | undefined,
    listener: ChildProcess | undefined,
    connection: Connection | undefined;
  let stage = 'bootstrap',
    interrupted = false,
    passed = false,
    cleanupComplete = true;
  const checks: string[] = [],
    remote = new Map<string, string>(),
    captures = new Map<string, { raw: Buffer; signature: string }>();
  const onInterrupt = () => {
    interrupted = true;
  };
  process.once('SIGINT', onInterrupt);
  const deadline = setTimeout(onInterrupt, 7 * 60_000);
  deadline.unref();
  const mark = (name: string) => {
    checks.push(name);
    process.stdout.write(JSON.stringify({ check: name, passed: true }) + '\n');
  };
  async function waitFor(
    test: () => Promise<boolean>,
    code: string,
    seconds = 60,
  ) {
    const until = Date.now() + seconds * 1000;
    while (Date.now() < until) {
      check(!interrupted, 'acceptance_interrupted');
      if (await test()) return;
      await delay(500);
    }
    throw new AcceptanceFailure(code);
  }
  async function call(
    agent: Agent,
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    data?: Json,
    expected = 200,
  ): Promise<Json> {
    const operation = agent[method](path);
    if (data) operation.send(data);
    const response = await operation;
    check(
      response.status === expected,
      'http_status_' + response.status + '_expected_' + expected,
    );
    return expected === 204 ? {} : object(response.body);
  }
  async function startListener(port: number) {
    const executable =
      process.env.STRIPE_CLI_PATH ??
      join(
        process.env.LOCALAPPDATA ?? '',
        'Programs',
        'StripeCLI',
        'stripe.exe',
      );
    // Pass the existing test credential through the child environment, never argv/history.
    listener = spawn(
      executable,
      [
        'listen',
        '--events',
        'payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,refund.created,refund.updated,refund.failed',
        '--forward-to',
        'http://127.0.0.1:' + port + '/api/payments/webhook',
        '--skip-update',
        '--color',
        'off',
      ],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, STRIPE_API_KEY: key },
      },
    );
    await new Promise<void>((done, reject) => {
      let buffer = '',
        ready = false;
      const timer = setTimeout(
        () => reject(new AcceptanceFailure('stripe_listener_start_timeout')),
        30_000,
      );
      const receive = (chunk: Buffer) => {
        buffer = (buffer + chunk.toString('utf8')).slice(-16_384);
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const match = line.match(/whsec_[A-Za-z0-9]+/);
          if (!match || ready) continue;
          clearTimeout(timer);
          if (match[0] !== signingSecret) {
            reject(
              new AcceptanceFailure(
                'configured_webhook_secret_does_not_match_this_sandbox_listener',
              ),
            );
            return;
          }
          ready = true;
          done();
        }
      };
      listener?.stdout?.on('data', receive);
      listener?.stderr?.on('data', receive);
      listener?.once('error', () => {
        clearTimeout(timer);
        reject(new AcceptanceFailure('stripe_cli_could_not_start'));
      });
      listener?.once('exit', () => {
        if (!ready) {
          clearTimeout(timer);
          reject(new AcceptanceFailure('stripe_listener_exited_before_ready'));
        }
      });
    });
  }
  async function run(): Promise<void> {
    mongo = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = mongo.getUri();
    check(
      /^mongodb:\/\/127\.0\.0\.1:\d+/.test(uri),
      'test_database_must_be_loopback',
    );
    const module = await Test.createTestingModule({
      imports: [
        AcceptanceConfiguration,
        MongooseModule.forRoot(uri, {
          dbName: 'giu_stripe_acceptance_' + randomUUID().replace(/-/g, ''),
        }),
        AdministrationModule,
        FlightsModule,
        PaymentsModule,
      ],
    }).compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    app.setGlobalPrefix('api');
    configurePaymentBodyParsers(app);
    app.use(
      '/api/payments/webhook',
      (req: Request, res: Response, next: NextFunction) => {
        const body = req.body as unknown,
          signature = req.header('Stripe-Signature');
        if (Buffer.isBuffer(body) && signature) {
          // Retain bytes only in this process for a signed replay check. No raw payload is logged.
          res.once('finish', () => {
            if (res.statusCode < 300 && captures.size < 100) {
              try {
                const event = object(JSON.parse(body.toString('utf8')));
                if (typeof event.id === 'string')
                  captures.set(event.id, { raw: Buffer.from(body), signature });
              } catch {
                /* Invalid bodies are not test evidence. */
              }
            }
          });
        }
        next();
      },
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const base = 'http://127.0.0.1:' + address.port;
    const db = app.get<Connection>(getConnectionToken());
    connection = db;
    await seedOfficialReferences(db);
    await Promise.all(db.modelNames().map((name) => db.model(name).init()));
    const userModel = app.get<Model<User>>(getModelToken(User.name));
    const hash = await hashPassword('acceptance-password1');
    await userModel.create([
      {
        email: 'admin@acceptance.invalid',
        fullName: 'Synthetic acceptance admin',
        roles: ['admin'],
        passwordHash: hash,
      },
      {
        email: 'traveler@acceptance.invalid',
        fullName: 'Synthetic acceptance traveler',
        roles: ['traveler'],
        passwordHash: hash,
      },
    ]);
    async function login(email: string, password = 'acceptance-password1') {
      const agent = request.agent(base);
      await call(agent, 'post', '/api/auth/login', { email, password });
      return agent;
    }
    const admin = await login('admin@acceptance.invalid');
    let owner = await login('traveler@acceptance.invalid');
    if (!fixtureOnly) {
      stage = 'webhook_listener';
      await startListener(address.port);
      mark('isolated_database_and_matching_signed_listener');
    }
    async function moderator(
      role: 'airline_moderator' | 'hotel_moderator',
      id: string,
      email: string,
    ) {
      await call(
        admin,
        'post',
        '/api/admin/moderators',
        {
          fullName: 'Synthetic acceptance moderator',
          email,
          password: 'temporary-password1',
          role,
          providerId: id,
        },
        201,
      );
      let agent = await login(email, 'temporary-password1');
      await call(
        agent,
        'patch',
        '/api/auth/change-password',
        {
          currentPassword: 'temporary-password1',
          newPassword: 'changed-password2',
        },
        204,
      );
      agent = await login(email, 'changed-password2');
      return agent;
    }
    const airline = await call(
      admin,
      'post',
      '/api/airlines',
      {
        name: 'Synthetic Stripe acceptance airline',
        code: 'AC',
        logoUrl: 'https://example.com/synthetic-logo.png',
      },
      201,
    );
    const airlineId = string(airline.id),
      flightMod = await moderator(
        'airline_moderator',
        airlineId,
        'airline@acceptance.invalid',
      );
    await call(
      flightMod,
      'put',
      '/api/airlines/' + airlineId + '/baggage-policy',
      { extraBagPrice: 1, maxExtraBags: 1 },
    );
    await call(
      flightMod,
      'put',
      '/api/airlines/' + airlineId + '/cancellation-policy',
      { tiers: [{ daysBeforeDeparture: 0, refundPercentage: 100 }] },
    );
    const future = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    async function createFlight(number: string) {
      const created = await call(
        flightMod,
        'post',
        '/api/flights',
        {
          flightNumber: number,
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'JFK',
          departureLocalDateTime: future + 'T10:00',
          arrivalLocalDateTime: future + 'T18:00',
          cabins: [
            {
              category: 'Economy',
              totalSeats: 5,
              price: 100,
              freeBags: 1,
              maxWeightPerBag: 23,
            },
          ],
        },
        201,
      );
      return string(created.id);
    }
    const flightId = await createFlight('AC001');
    const paymentModel = app.get<Model<Payment>>(getModelToken(Payment.name)),
      eventModel = app.get<Model<PaymentEvent>>(
        getModelToken(PaymentEvent.name),
      ),
      refundModel = app.get<Model<Refund>>(getModelToken(Refund.name));
    const flightModel = app.get<Model<Flight>>(getModelToken(Flight.name)),
      flightBookings = app.get<Model<FlightBooking>>(
        getModelToken(FlightBooking.name),
      );
    const hotelBookings = app.get<Model<HotelBooking>>(
      getModelToken(HotelBooking.name),
    );
    async function flightHold(id: string) {
      const result = await call(
        owner,
        'post',
        '/api/flight-bookings/hold',
        {
          flightId: id,
          cabinCategory: 'Economy',
          passengers: [
            {
              fullName: 'Synthetic acceptance passenger',
              dateOfBirth: '1990-01-01',
              identityDocumentNumber: 'SYNTHETIC-NOT-A-REAL-ID',
              extraBags: 0,
            },
          ],
        },
        201,
      );
      return string(object(result.booking).id);
    }
    async function payment(
      kind: 'hotel' | 'flight',
      bookingId: string,
    ): Promise<PaidAttempt> {
      const path = '/api/bookings/' + kind + '/' + bookingId;
      const before = await owner
        .post('/api/payments')
        .send({ bookingType: kind, bookingId });
      check(before.status === 409, 'payment_must_require_policy_acceptance');
      const policy = await call(owner, 'get', path + '/policies');
      await call(owner, 'post', path + '/accept-policies', {
        accepted: true,
        policyToken: string(policy.policyToken),
      });
      const result = object(
        (
          await call(
            owner,
            'post',
            '/api/payments',
            { bookingType: kind, bookingId },
            201,
          )
        ).payment,
      );
      const attempt = {
        id: string(result.id),
        stripePaymentId: string(result.stripePaymentId),
        amountMinor: Number(result.amountMinor),
      };
      check(
        /^pi_[A-Za-z0-9]+$/.test(attempt.stripePaymentId) &&
          attempt.amountMinor >= 50,
        'invalid_stripe_payment_link',
      );
      remote.set(attempt.stripePaymentId, attempt.id);
      check(remote.size <= 3, 'acceptance_payment_limit');
      return attempt;
    }
    async function confirm(
      attempt: PaidAttempt,
      kind: 'flight' | 'hotel',
      bookingId: string,
    ) {
      const confirmed = await stripe.paymentIntents.confirm(
        attempt.stripePaymentId,
        { payment_method: 'pm_card_visa' },
      );
      check(
        confirmed.livemode === false && confirmed.status === 'succeeded',
        'stripe_test_payment_not_succeeded',
      );
      await waitFor(
        async () =>
          Boolean(
            await eventModel.exists({
              resourceId: attempt.stripePaymentId,
              type: 'payment_intent.succeeded',
              status: 'processed',
            }),
          ),
        'genuine_successful_webhook_not_processed',
      );
      const booking = await call(
        owner,
        'get',
        '/api/' +
          (kind === 'flight' ? 'flight-bookings' : 'hotel-bookings') +
          '/' +
          bookingId,
      );
      check(
        booking.status === 'Confirmed' && typeof booking.reference === 'string',
        'verified_payment_did_not_confirm_booking',
      );
      const stored = await paymentModel.findById(attempt.id).orFail();
      check(
        stored.fulfillment === 'confirmed' && stored.status === 'succeeded',
        'payment_state_not_settled',
      );
    }
    async function refund(attempt: PaidAttempt) {
      const record = await refundModel
        .findOne({ paymentId: attempt.id })
        .orFail();
      check(
        record.amountMinor === attempt.amountMinor,
        'full_refund_not_reserved',
      );
      await app!.get(RefundsService).sync(record._id.toString());
      const result = await call(owner, 'get', '/api/refunds/' + record._id);
      check(
        result.status === 'Refunded' &&
          result.amountMinor === attempt.amountMinor,
        'stripe_refund_not_completed',
      );
      await waitFor(async () => {
        await app!.get(PaymentsService).runDue();
        return Boolean(
          await eventModel.exists({
            resourceId: (await refundModel.findById(record._id).orFail())
              .stripeRefundId,
            resourceType: 'refund',
            status: 'processed',
          }),
        );
      }, 'genuine_refund_webhook_not_processed');
    }
    if (fixtureOnly) {
      stage = 'offline_fixture_routes';
      const id = await flightHold(flightId);
      const hotelId = await hotelHold();
      for (const [kind, bookingId] of [
        ['flight', id],
        ['hotel', hotelId],
      ]) {
        const path = '/api/bookings/' + kind + '/' + bookingId;
        const review = await call(owner, 'get', path + '/policies');
        await call(owner, 'post', path + '/accept-policies', {
          accepted: true,
          policyToken: string(review.policyToken),
        });
      }
      mark('offline_actual_auth_provider_inventory_booking_and_policy_routes');
      passed = true;
      return;
    }
    stage = 'flight_payment_and_replay';
    const flightBookingId = await flightHold(flightId),
      flightPayment = await payment('flight', flightBookingId);
    await confirm(flightPayment, 'flight', flightBookingId);
    const event = await eventModel
      .findOne({
        resourceId: flightPayment.stripePaymentId,
        type: 'payment_intent.succeeded',
        status: 'processed',
      })
      .orFail();
    const captured = captures.get(event.eventId);
    check(captured, 'signed_success_capture_missing');
    const bad = await owner
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', captured.signature)
      .send(Buffer.concat([captured.raw, Buffer.from(' ')]).toString('utf8'));
    check(bad.status === 400, 'tampered_webhook_not_rejected');
    const replay = await owner
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', captured.signature)
      .send(captured.raw.toString('utf8'));
    check(replay.status === 200, 'genuine_webhook_replay_failed');
    check(
      (await eventModel.countDocuments({ eventId: event.eventId })) === 1,
      'webhook_replay_duplicated_record',
    );
    check(
      (await flightModel.findById(flightId).orFail()).cabins[0].bookedSeats ===
        1,
      'webhook_replay_duplicated_inventory',
    );
    const pdf = await owner.get(
      '/api/flight-bookings/' + flightBookingId + '/e-ticket',
    );
    check(
      pdf.status === 200 &&
        Buffer.isBuffer(pdf.body) &&
        pdf.body.subarray(0, 5).toString() === '%PDF-',
      'paid_ticket_unavailable',
    );
    mark('flight_real_payment_signed_webhook_replay_tamper_and_pdf');
    stage = 'provider_full_refund';
    await call(flightMod, 'post', '/api/flights/' + flightId + '/cancel', {
      confirmed: true,
    });
    await refund(flightPayment);
    check(
      (await flightBookings.findById(flightBookingId).orFail()).status ===
        'Cancelled',
      'provider_cancellation_state_incorrect',
    );
    check(
      (await flightModel.findById(flightId).orFail()).cabins[0].bookedSeats ===
        0,
      'provider_cancellation_inventory_not_released',
    );
    mark('provider_cancellation_real_full_refund');
    stage = 'hotel_decline_retry_and_refund';
    owner = await login('traveler@acceptance.invalid');
    const hotelBookingId = await hotelHold(),
      hotelPayment = await payment('hotel', hotelBookingId);
    async function hotelHold(): Promise<string> {
      const hotelId = string(
        (
          await call(
            admin,
            'post',
            '/api/hotels',
            {
              name: 'Synthetic Stripe acceptance hotel',
              address: 'Synthetic test address',
              cityId: 'cairo',
              countryCode: 'EG',
              starRating: 3,
            },
            201,
          )
        ).id,
      );
      const hotelMod = await moderator(
        'hotel_moderator',
        hotelId,
        'hotel@acceptance.invalid',
      );
      await call(hotelMod, 'put', '/api/hotels/' + hotelId + '/policies', {
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
      });
      const roomId = string(
        (
          await call(
            hotelMod,
            'post',
            '/api/hotels/' + hotelId + '/rooms',
            {
              name: 'Synthetic acceptance room',
              type: 'Double',
              beds: 1,
              maxOccupancy: 2,
              pricePerNightMinor: 100,
            },
            201,
          )
        ).id,
      );
      const checkOut = new Date(Date.now() + 32 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await call(
        hotelMod,
        'post',
        '/api/hotels/' + hotelId + '/rooms/' + roomId + '/availability',
        { from: future, to: checkOut },
        201,
      );
      return string(
        (
          await call(
            owner,
            'post',
            '/api/hotel-bookings',
            {
              hotelId,
              checkIn: future,
              checkOut,
              rooms: [{ roomId, adults: 1 }],
            },
            201,
          )
        ).id,
      );
    }
    let declined = false;
    try {
      await stripe.paymentIntents.confirm(hotelPayment.stripePaymentId, {
        payment_method: 'pm_card_visa_chargeDeclined',
      });
    } catch (error) {
      declined = error instanceof Stripe.errors.StripeCardError;
    }
    check(declined, 'expected_test_card_decline_missing');
    await waitFor(
      async () =>
        Boolean(
          await eventModel.exists({
            resourceId: hotelPayment.stripePaymentId,
            type: 'payment_intent.payment_failed',
            status: 'processed',
          }),
        ),
      'genuine_decline_webhook_not_processed',
    );
    check(
      (await hotelBookings.findById(hotelBookingId).orFail()).status ===
        'Pending Payment',
      'decline_must_not_confirm_reservation',
    );
    await call(
      owner,
      'post',
      '/api/payments/' + hotelPayment.id + '/retry',
      {},
      200,
    );
    await confirm(hotelPayment, 'hotel', hotelBookingId);
    await call(
      owner,
      'post',
      '/api/hotel-bookings/' + hotelBookingId + '/cancel',
      {},
    );
    await refund(hotelPayment);
    mark('hotel_real_decline_retry_confirmation_and_user_full_refund');
    stage = 'unpaid_expiry_cancels_stripe_intent';
    const expiringFlight = await createFlight('AC002'),
      expiringBooking = await flightHold(expiringFlight),
      expiringPayment = await payment('flight', expiringBooking);
    // Force only this disposable fixture's deadline; do not claim ten real minutes elapsed.
    const past = new Date(Date.now() - 1000);
    await db.transaction(async (session) => {
      await flightBookings.updateOne(
        { _id: expiringBooking },
        { $set: { holdExpiresAt: past } },
        { session },
      );
      await paymentModel.updateOne(
        { _id: expiringPayment.id },
        { $set: { holdExpiresAt: past } },
        { session },
      );
    });
    await app.get(PaymentsService).expire(expiringPayment.id);
    const expired = await stripe.paymentIntents.retrieve(
      expiringPayment.stripePaymentId,
    );
    check(
      expired.livemode === false && expired.status === 'canceled',
      'unpaid_intent_not_canceled',
    );
    check(
      (await flightBookings.findById(expiringBooking).orFail()).status ===
        'Expired',
      'booking_not_expired',
    );
    check(
      (await flightModel.findById(expiringFlight).orFail()).cabins[0]
        .heldSeats === 0,
      'expired_inventory_not_released',
    );
    mark(
      'forced_fixture_expiry_real_stripe_cancellation_and_inventory_release',
    );
    await app.get(DomainEventConsumer).consumePending();
    await app.get(CommittedOutboxConsumer).consumePending();
    const notices = await call(owner, 'get', '/api/notifications');
    check(
      Array.isArray(notices.data) && notices.data.length > 0,
      'actual_notifications_missing',
    );
    check(
      await app
        .get<Model<AuditLog>>(getModelToken(AuditLog.name))
        .exists({ action: 'refund.status_changed', outcome: 'success' }),
      'actual_refund_audit_missing',
    );
    mark('actual_notification_and_audit_delivery');
    passed = true;
  }
  try {
    await run();
  } catch (error) {
    const code =
      error instanceof AcceptanceFailure
        ? error.code
        : 'unexpected_operation_failure';
    const provider =
      error instanceof Stripe.errors.StripeError
        ? {
            type: error.type,
            status: error.statusCode,
            code:
              typeof error.code === 'string' &&
              /^[a-z_]{1,80}$/.test(error.code)
                ? error.code
                : undefined,
          }
        : undefined;
    process.stdout.write(
      JSON.stringify({ passed: false, stage, code, provider }) + '\n',
    );
  } finally {
    // Recover persisted IDs even if an HTTP response failed after intent creation.
    if (
      connection?.readyState === 1 &&
      connection.modelNames().includes(Payment.name)
    ) {
      try {
        const saved = await connection
          .model<Payment>(Payment.name)
          .find({ stripeIntentId: { $type: 'string' } })
          .select('_id stripeIntentId')
          .lean();
        for (const payment of saved)
          if (payment.stripeIntentId)
            remote.set(payment.stripeIntentId, payment._id.toString());
      } catch {
        cleanupComplete = false;
      }
    }
    // Clean only objects created by this run, with test mode and metadata ownership checks.
    for (const [id, paymentId] of remote) {
      try {
        const intent = await stripe.paymentIntents.retrieve(id);
        check(
          intent.livemode === false && intent.metadata.payment_id === paymentId,
          'cleanup_resource_ownership_mismatch',
        );
        if (intent.status === 'succeeded') {
          const refunds = await stripe.refunds.list({
            payment_intent: id,
            limit: 100,
          });
          const refunded = refunds.data
            .filter((r) => r.status === 'succeeded' || r.status === 'pending')
            .reduce((sum, r) => sum + r.amount, 0);
          const remaining = intent.amount_received - refunded;
          if (remaining > 0)
            await stripe.refunds.create(
              {
                payment_intent: id,
                amount: remaining,
                metadata: { acceptance_cleanup: 'true' },
              },
              { idempotencyKey: 'acceptance:' + paymentId + ':cleanup' },
            );
        } else if (intent.status !== 'canceled')
          await stripe.paymentIntents.cancel(id);
      } catch {
        cleanupComplete = false;
      }
    }
    listener?.kill();
    await app?.close();
    await mongo?.stop();
    captures.clear();
    clearTimeout(deadline);
    process.removeListener('SIGINT', onInterrupt);
    const target = resolve(mediaRoot),
      withinTemp = relative(resolve(tmpdir()), target);
    check(
      Boolean(withinTemp) &&
        !withinTemp.startsWith('..') &&
        !isAbsolute(withinTemp) &&
        basename(target).startsWith('giu-stripe-acceptance-'),
      'unsafe_temporary_cleanup_path',
    );
    rmSync(target, { recursive: true, force: true });
    process.stdout.write(
      JSON.stringify({
        passed,
        mode: fixtureOnly
          ? 'offline_fixture_verification'
          : 'external_stripe_acceptance',
        cleanupComplete,
        checks,
        sharedDatabaseUsed: false,
        credentialValuesPrinted: false,
      }) + '\n',
    );
    if (!passed || !cleanupComplete) process.exitCode = 1;
  }
}
void main().catch(() => {
  process.stdout.write(
    JSON.stringify({
      passed: false,
      code: 'acceptance_preflight_or_cleanup_failed',
      credentialValuesPrinted: false,
    }) + '\n',
  );
  process.exitCode = 1;
});
