import {
  convertMinor,
  convertedBudgetSummary,
} from './converted-budget-summary';
import { NativeBudgetSummaryDto } from './dto/budget-summary.dto';

const rates = {
  USD: 1,
  EGP: 50,
  AED: 3.67,
  GBP: 0.5,
  EUR: 0.8,
  JPY: 150,
  SAR: 3.75,
};

describe('Preferred-currency monetary arithmetic', () => {
  it.each([
    [10000, 'USD', 'EGP', 500000],
    [10000, 'USD', 'JPY', 15000],
    [15000, 'JPY', 'USD', 10000],
    [12345, 'EGP', 'EUR', 198],
    [1, 'USD', 'GBP', 1],
    [0, 'USD', 'GBP', 0],
    [Number.MAX_SAFE_INTEGER, 'JPY', 'JPY', Number.MAX_SAFE_INTEGER],
  ])('converts %s %s minor units to %s as %s', (amount, from, to, expected) => {
    expect(convertMinor(Number(amount), String(from), String(to), rates)).toBe(
      expected,
    );
  });

  it('avoids precision loss near the safe-integer boundary', () => {
    expect(convertMinor(Number.MAX_SAFE_INTEGER, 'USD', 'EUR', rates)).toBe(
      7205759403792793,
    );
  });

  it('handles exchange-rate scientific notation as exact decimal fractions', () => {
    expect(convertMinor(1, 'USD', 'EGP', { USD: 1e-7, EGP: 1 })).toBe(10000000);
    expect(convertMinor(1000, 'USD', 'EGP', { USD: 1e21, EGP: 1e21 })).toBe(
      1000,
    );
  });

  it.each([
    [-1, 'USD', 'EGP'],
    [1.5, 'USD', 'EGP'],
    [Number.MAX_SAFE_INTEGER + 1, 'USD', 'EGP'],
    [1, 'XYZ', 'EGP'],
    [1, 'USD', 'XYZ'],
    [Number.MAX_SAFE_INTEGER, 'USD', 'EGP'],
  ])(
    'rejects an unsupported or overflowing conversion (%j, %s, %s)',
    (amount, from, to) => {
      expect(() =>
        convertMinor(Number(amount), String(from), String(to), rates),
      ).toThrow();
    },
  );

  it('rejects missing rates', () => {
    expect(() => convertMinor(100, 'USD', 'EGP', { USD: 1 })).toThrow();
  });

  it('reconciles day, category and overall totals while preserving the native summary', () => {
    const native: NativeBudgetSummaryDto = {
      totalByCurrency: { USD: 2 },
      byCategory: {
        food: { USD: 2 },
        accommodation: {},
        in_city_transport: {},
        activities: {},
        intercity_transport: {},
      },
      byDay: [1, 2].map((dayNumber) => ({
        dayId: `day-${dayNumber}`,
        dayNumber,
        date: '2026-11-20',
        totalByCurrency: { USD: 1 },
        byCategory: {
          food: { USD: 1 },
          accommodation: {},
          in_city_transport: {},
          activities: {},
          intercity_transport: {},
        },
      })),
    };
    const original = JSON.stringify(native);
    const converted = convertedBudgetSummary(native, 'GBP', {
      rates,
      rateDate: '2026-11-16',
      fetchedAt: '2026-11-16T10:00:00.000Z',
      fallback: false,
      stale: false,
    });
    // Each daily-category/source subtotal rounds once, so two half pennies total two pennies.
    expect(converted.totalMinor).toBe(2);
    expect(converted.byCategory.food).toBe(2);
    expect(converted.byDay.map((day) => day.totalMinor)).toEqual([1, 1]);
    expect(JSON.stringify(native)).toBe(original);
  });
});
