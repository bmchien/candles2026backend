import { DiscountType } from '@prisma/client';
import { calculateFinalPrice, isDiscountActive, PricedProduct, validateDiscount } from './pricing';

const NOW = new Date('2026-10-06T12:00:00Z');
const day = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * day);

const product = (overrides: Partial<PricedProduct> = {}): PricedProduct => ({
  price: 1_000_000,
  discountType: DiscountType.NONE,
  discountValue: 0,
  discountStart: null,
  discountEnd: null,
  ...overrides,
});

describe('pricing: calculateFinalPrice', () => {
  it('returns the base price when there is no discount', () => {
    expect(calculateFinalPrice(product(), NOW).toNumber()).toBe(1_000_000);
  });

  it('applies a PERCENT discount: price × (1 − value/100)', () => {
    const p = product({
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      discountStart: at(-1),
      discountEnd: at(1),
    });
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(900_000);
  });

  it('applies a FIXED discount: price − value', () => {
    const p = product({
      discountType: DiscountType.FIXED,
      discountValue: 250_000,
      discountStart: at(-1),
      discountEnd: at(1),
    });
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(750_000);
  });

  it('never goes below zero for FIXED: max(price − value, 0)', () => {
    const p = product({ discountType: DiscountType.FIXED, discountValue: 5_000_000 });
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(0);
  });

  it('gives 0 for a 100% discount', () => {
    const p = product({ discountType: DiscountType.PERCENT, discountValue: 100 });
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(0);
  });

  it('ignores a discount that has not started yet', () => {
    const p = product({
      discountType: DiscountType.PERCENT,
      discountValue: 50,
      discountStart: at(1),
      discountEnd: at(5),
    });
    expect(isDiscountActive(p, NOW)).toBe(false);
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(1_000_000);
  });

  it('ignores an expired discount', () => {
    const p = product({
      discountType: DiscountType.FIXED,
      discountValue: 100_000,
      discountStart: at(-10),
      discountEnd: at(-1),
    });
    expect(isDiscountActive(p, NOW)).toBe(false);
    expect(calculateFinalPrice(p, NOW).toNumber()).toBe(1_000_000);
  });

  it('treats the window bounds as inclusive', () => {
    const p = product({
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      discountStart: NOW,
      discountEnd: NOW,
    });
    expect(isDiscountActive(p, NOW)).toBe(true);
  });

  it('treats NULL bounds as open-ended', () => {
    expect(
      isDiscountActive(
        product({ discountType: DiscountType.PERCENT, discountValue: 5, discountEnd: at(1) }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isDiscountActive(
        product({ discountType: DiscountType.PERCENT, discountValue: 5, discountStart: at(-1) }),
        NOW,
      ),
    ).toBe(true);
  });

  it('rounds to 2 decimals (half-up)', () => {
    const p = product({ price: '99.99', discountType: DiscountType.PERCENT, discountValue: 15 });
    // 99.99 × 0.85 = 84.9915 -> 84.99
    expect(calculateFinalPrice(p, NOW).toFixed(2)).toBe('84.99');
    const q = product({ price: '0.05', discountType: DiscountType.PERCENT, discountValue: 50 });
    // 0.025 -> 0.03
    expect(calculateFinalPrice(q, NOW).toFixed(2)).toBe('0.03');
  });

  it('a zero-value discount is not considered active', () => {
    expect(
      isDiscountActive(product({ discountType: DiscountType.FIXED, discountValue: 0 }), NOW),
    ).toBe(false);
  });
});

describe('pricing: validateDiscount', () => {
  it('accepts PERCENT within 0..100', () => {
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.PERCENT, discountValue: 0 }),
    ).toBeNull();
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.PERCENT, discountValue: 100 }),
    ).toBeNull();
  });

  it('rejects PERCENT above 100 or below 0', () => {
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.PERCENT, discountValue: 101 }),
    ).toMatch(/PERCENT/);
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.PERCENT, discountValue: -1 }),
    ).toMatch(/>= 0/);
  });

  it('rejects FIXED greater than the price but accepts equal', () => {
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.FIXED, discountValue: 101 }),
    ).toMatch(/FIXED/);
    expect(
      validateDiscount({ price: 100, discountType: DiscountType.FIXED, discountValue: 100 }),
    ).toBeNull();
  });

  it('rejects a window that ends before it starts', () => {
    expect(
      validateDiscount({
        price: 100,
        discountType: DiscountType.PERCENT,
        discountValue: 10,
        discountStart: at(2),
        discountEnd: at(1),
      }),
    ).toMatch(/discount_start/);
  });
});
