import { DiscountType, ProductStatus } from '@prisma/client';
import { CSV_COLUMNS, CsvLookups, parseCsvRow } from './csv-row.parser';

const lookups: CsvLookups = {
  categories: new Map([
    ['laptop', 1n],
    ['máy tính xách tay', 1n],
  ]),
  tags: new Map([
    ['ban-chay', 10n],
    ['giá rẻ', 11n],
  ]),
};
const allColumns = new Set<string>(CSV_COLUMNS);

const row = (overrides: Record<string, string> = {}) => ({
  code: 'SKU-1',
  name: 'Laptop A',
  short_description: 'Ngắn',
  description: 'Dài',
  category: 'laptop',
  price: '1000000',
  discount_type: '',
  discount_value: '',
  discount_start: '',
  discount_end: '',
  status: '',
  is_active: '',
  tags: '',
  ...overrides,
});

describe('parseCsvRow', () => {
  it('parses a valid row with defaults', () => {
    const r = parseCsvRow(row(), allColumns, lookups);
    expect(r).toEqual({
      ok: true,
      data: expect.objectContaining({
        code: 'SKU-1',
        categoryId: 1n,
        price: 1_000_000,
        discountType: DiscountType.NONE,
        discountValue: 0,
        status: ProductStatus.IN_STOCK,
        isActive: true,
        tagIds: [],
      }),
    });
  });

  it('resolves category and tags by name or slug, case-insensitively', () => {
    const r = parseCsvRow(
      row({ category: 'Máy tính xách tay', tags: 'BAN-CHAY|Giá rẻ' }),
      allColumns,
      lookups,
    );
    expect(r.ok && r.data.categoryId).toBe(1n);
    expect(r.ok && r.data.tagIds).toEqual([10n, 11n]);
  });

  it('reports every problem in the row', () => {
    const r = parseCsvRow(
      row({
        code: '',
        price: '-5',
        category: 'unknown',
        status: 'SOLD',
        is_active: 'maybe',
        tags: 'nope',
      }),
      allColumns,
      lookups,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual(
        expect.arrayContaining([
          'code is required',
          expect.stringMatching(/price/),
          'category "unknown" not found',
          expect.stringMatching(/status/),
          expect.stringMatching(/is_active/),
          'tag "nope" not found',
        ]),
      );
    }
  });

  it('applies discount validation rules', () => {
    const tooBig = parseCsvRow(
      row({ discount_type: 'FIXED', discount_value: '2000000' }),
      allColumns,
      lookups,
    );
    expect(tooBig.ok).toBe(false);
    const pct = parseCsvRow(
      row({ discount_type: 'percent', discount_value: '150' }),
      allColumns,
      lookups,
    );
    expect(pct.ok).toBe(false);
    const ok = parseCsvRow(
      row({
        discount_type: 'PERCENT',
        discount_value: '20',
        discount_start: '2026-01-01',
        discount_end: '2026-12-31',
      }),
      allColumns,
      lookups,
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects invalid dates', () => {
    const r = parseCsvRow(row({ discount_start: 'not-a-date' }), allColumns, lookups);
    expect(r.ok).toBe(false);
  });

  it('omits fields whose column is absent so updates keep existing values', () => {
    const r = parseCsvRow(
      { code: 'SKU-1', name: 'A', category: 'laptop', price: '10' },
      new Set(['code', 'name', 'category', 'price']),
      lookups,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).not.toHaveProperty('status');
      expect(r.data).not.toHaveProperty('tagIds');
      expect(r.data).not.toHaveProperty('isActive');
    }
  });
});
