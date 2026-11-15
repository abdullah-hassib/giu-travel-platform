import * as Joi from 'joi';

// Rejected missing or placeholder Atlas URI. Avoid logging secrets in error messages.
export const environmentSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  SESSION_TTL_HOURS: Joi.number().integer().min(1).max(168).default(24),
  AUTH_MAX_FAILED_ATTEMPTS: Joi.number().valid(5).default(5),
  AUTH_LOCKOUT_MINUTES: Joi.number().valid(15).default(15),
  MONGODB_URI: Joi.string().pattern(/^mongodb(\+srv)?:\/\//).invalid('mongodb+srv://<username>:<password>@<cluster-host>/<database>?retryWrites=true&w=majority').required(),
}).unknown(true);
