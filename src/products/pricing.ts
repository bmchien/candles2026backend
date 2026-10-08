import { DiscountType, Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
type Numeric = Decimal | number | string;

export interface PricedProduct {
  price: Numeric;
  discountType: DiscountType;
  discountValue: Numeric;
  discountStart: Date | null;
  discountEnd: Date | null;
}

const toDecimal = (v: Numeric): Decimal => (Decimal.isDecimal(v) ? v : new Decimal(v));

/** Money is DECIMAL(12,2): round half-up to 2 decimal places. */
export const roundMoney = (v: Decimal): Decimal => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * HLD §5: a discount applies only while the server time is inside
 * [discount_start, discount_end]. A NULL bound means "open-ended" on that side.
 */
export function isDiscountActive(p: PricedProduct, now: Date = new Date()): boolean {
  if (p.discountType === DiscountType.NONE) return false;
  if (toDecimal(p.discountValue).lte(0)) return false;
  if (p.discountStart && now < p.discountStart) return false;
  if (p.discountEnd && now > p.discountEnd) return false;
  return true;
}

/**
 * Final price, computed on the fly (never stored):
 *   PERCENT: price × (1 − value/100)
 *   FIXED:   max(price − value, 0)
 *   otherwise price
 */
export function calculateFinalPrice(p: PricedProduct, now: Date = new Date()): Decimal {
  const price = toDecimal(p.price);
  if (!isDiscountActive(p, now)) return roundMoney(price);
  const value = toDecimal(p.discountValue);
  switch (p.discountType) {
    case DiscountType.PERCENT:
      return roundMoney(price.mul(new Decimal(1).minus(value.div(100))));
    case DiscountType.FIXED:
      return roundMoney(Decimal.max(price.minus(value), 0));
    default:
      return roundMoney(price);
  }
}

export interface DiscountInput {
  price: Numeric;
  discountType: DiscountType;
  discountValue?: Numeric | null;
  discountStart?: Date | null;
  discountEnd?: Date | null;
}

/**
 * HLD §5 validation: PERCENT within 0–100, FIXED not above the price,
 * and the window must not end before it starts.
 * Returns an error message, or null when valid.
 */
export function validateDiscount(input: DiscountInput): string | null {
  const price = toDecimal(input.price);
  if (price.lt(0)) return 'price must be >= 0';
  const value = toDecimal(input.discountValue ?? 0);
  if (value.lt(0)) return 'discount_value must be >= 0';

  switch (input.discountType) {
    case DiscountType.NONE:
      break;
    case DiscountType.PERCENT:
      if (value.gt(100)) return 'PERCENT discount_value must be between 0 and 100';
      break;
    case DiscountType.FIXED:
      if (value.gt(price)) return 'FIXED discount_value must not exceed price';
      break;
    default:
      return 'Unknown discount_type';
  }

  if (input.discountStart && input.discountEnd && input.discountStart > input.discountEnd) {
    return 'discount_start must be before discount_end';
  }
  return null;
}

/**
 * SQL expression computing the same final price inside PostgreSQL, so list
 * endpoints can filter/sort by the *discounted* price. Must stay in sync with
 * calculateFinalPrice (covered by the e2e filtering test).
 * `now` is passed as a parameter so the server clock is the source of truth.
 */
export function finalPriceSql(now: Date, alias = 'p'): Prisma.Sql {
  const a = Prisma.raw(alias);
  // Prisma stores DateTime as UTC in `timestamp without time zone` columns.
  const ts = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  return Prisma.sql`(CASE
    WHEN ${a}.discount_type <> 'NONE'
      AND ${a}.discount_value > 0
      AND (${a}.discount_start IS NULL OR ${a}.discount_start <= ${ts})
      AND (${a}.discount_end IS NULL OR ${a}.discount_end >= ${ts})
    THEN CASE ${a}.discount_type
      WHEN 'PERCENT' THEN ROUND(${a}.price * (1 - ${a}.discount_value / 100), 2)
      ELSE GREATEST(${a}.price - ${a}.discount_value, 0)
    END
    ELSE ${a}.price
  END)`;
}
