export const STRIPE_INTENT_STATUSES = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
  'canceled',
  'succeeded',
] as const;
export type StripeIntentStatus = (typeof STRIPE_INTENT_STATUSES)[number];

export function isStripeIntentStatus(
  value: unknown,
): value is StripeIntentStatus {
  return (
    typeof value === 'string' &&
    (STRIPE_INTENT_STATUSES as readonly string[]).includes(value)
  );
}
