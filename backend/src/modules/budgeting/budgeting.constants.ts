export const BUDGET_CATEGORIES = [
  'food',
  'accommodation',
  'in_city_transport',
  'activities',
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
export type SummaryCategory = BudgetCategory | 'intercity_transport';
