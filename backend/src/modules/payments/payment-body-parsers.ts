import { INestApplication } from '@nestjs/common';
import { json, raw, urlencoded } from 'express';

/** Install before app.init with Nest's automatic body parser disabled. */
export function configurePaymentBodyParsers(app: INestApplication): void {
  // Signature verification receives original bytes, before JSON parsing.
  app.use('/api/payments/webhook', raw({ type: 'application/json' }));
  app.use(json());
  app.use(urlencoded({ extended: true }));
}
