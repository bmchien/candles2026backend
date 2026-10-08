import { DiscountType, ProductStatus } from '@prisma/client';
import { validateDiscount } from './pricing';

export const CSV_COLUMNS = [
  'code',
  'name',
  'short_description',
  'description',
  'category',
  'price',
  'discount_type',
  'discount_value',
  'discount_start',
  'discount_end',
  'status',
  'is_active',
  'tags',
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];
export const REQUIRED_CSV_COLUMNS: CsvColumn[] = ['code', 'name', 'category', 'price'];

export interface CsvLookups {
  /** lower-cased slug or name -> category id */
  categories: Map<string, bigint>;
  /** lower-cased slug or name -> tag id */
  tags: Map<string, bigint>;
}

/** Parsed row. Fields are only present when their column exists in the file header. */
export interface ParsedCsvRow {
  code: string;
  name: string;
  categoryId: bigint;
  price: number;
  shortDescription?: string | null;
  description?: string | null;
  discountType?: DiscountType;
  discountValue?: number;
  discountStart?: Date | null;
  discountEnd?: Date | null;
  status?: ProductStatus;
  isActive?: boolean;
  tagIds?: bigint[];
}

export type CsvRowResult = { ok: true; data: ParsedCsvRow } | { ok: false; errors: string[] };

const CODE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;
const TRUE_VALUES = new Set(['true', '1', 'yes', 'y']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n']);

const parseDate = (value: string): Date | null | 'invalid' => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};

/**
 * Validates one CSV record and converts it to typed product fields.
 * Collects every problem in the row rather than stopping at the first one.
 */
export function parseCsvRow(
  raw: Record<string, string | undefined>,
  columns: Set<string>,
  lookups: CsvLookups,
): CsvRowResult {
  const errors: string[] = [];
  const v = (c: CsvColumn) => (raw[c] ?? '').trim();
  const has = (c: CsvColumn) => columns.has(c);

  const code = v('code');
  if (!code) errors.push('code is required');
  else if (!CODE_PATTERN.test(code))
    errors.push('code may contain only letters, digits, ".", "_", "-" (max 64)');

  const name = v('name');
  if (!name) errors.push('name is required');
  else if (name.length > 255) errors.push('name must be at most 255 characters');

  const categoryRaw = v('category');
  const categoryId = categoryRaw ? lookups.categories.get(categoryRaw.toLowerCase()) : undefined;
  if (!categoryRaw) errors.push('category is required');
  else if (categoryId === undefined) errors.push(`category "${categoryRaw}" not found`);

  const priceRaw = v('price');
  const price = Number(priceRaw);
  if (!MONEY_PATTERN.test(priceRaw))
    errors.push('price must be a non-negative number with at most 2 decimals');

  const data: Partial<ParsedCsvRow> = { code, name, categoryId, price };

  if (has('short_description')) {
    const s = v('short_description');
    if (s.length > 500) errors.push('short_description must be at most 500 characters');
    data.shortDescription = s || null;
  }
  if (has('description')) data.description = v('description') || null;

  if (has('discount_type')) {
    const t = (v('discount_type') || 'NONE').toUpperCase();
    if (t in DiscountType) data.discountType = t as DiscountType;
    else errors.push('discount_type must be NONE, PERCENT or FIXED');
  }
  if (has('discount_value')) {
    const raw = v('discount_value') || '0';
    if (MONEY_PATTERN.test(raw)) data.discountValue = Number(raw);
    else errors.push('discount_value must be a non-negative number with at most 2 decimals');
  }
  for (const [col, key] of [
    ['discount_start', 'discountStart'],
    ['discount_end', 'discountEnd'],
  ] as const) {
    if (!has(col)) continue;
    const d = parseDate(v(col));
    if (d === 'invalid') errors.push(`${col} must be an ISO-8601 date`);
    else data[key] = d;
  }

  if (has('status')) {
    const s = (v('status') || 'IN_STOCK').toUpperCase();
    if (s in ProductStatus) data.status = s as ProductStatus;
    else errors.push('status must be IN_STOCK or OUT_OF_STOCK');
  }

  if (has('is_active')) {
    const a = (v('is_active') || 'true').toLowerCase();
    if (TRUE_VALUES.has(a)) data.isActive = true;
    else if (FALSE_VALUES.has(a)) data.isActive = false;
    else errors.push('is_active must be true/false');
  }

  if (has('tags')) {
    const names = v('tags')
      .split(/[|;,]/)
      .map((t) => t.trim())
      .filter(Boolean);
    const ids: bigint[] = [];
    for (const t of names) {
      const id = lookups.tags.get(t.toLowerCase());
      if (id === undefined) errors.push(`tag "${t}" not found`);
      else if (!ids.includes(id)) ids.push(id);
    }
    data.tagIds = ids;
  }

  // Discount rules (HLD §5) — only meaningful once the individual fields parsed.
  if (!errors.length && (data.discountType ?? DiscountType.NONE) !== DiscountType.NONE) {
    const err = validateDiscount({
      price,
      discountType: data.discountType!,
      discountValue: data.discountValue ?? 0,
      discountStart: data.discountStart ?? null,
      discountEnd: data.discountEnd ?? null,
    });
    if (err) errors.push(err);
  }
  if (data.discountType === DiscountType.NONE) data.discountValue = 0;

  return errors.length ? { ok: false, errors } : { ok: true, data: data as ParsedCsvRow };
}
