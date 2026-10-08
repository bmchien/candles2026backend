import { Injectable, Logger } from '@nestjs/common';
import { DiscountType } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { INTERACTIVE_TX_OPTIONS } from '../prisma/transaction-options';
import {
  CSV_COLUMNS,
  CsvLookups,
  parseCsvRow,
  ParsedCsvRow,
  REQUIRED_CSV_COLUMNS,
} from './csv-row.parser';
import { validateDiscount } from './pricing';
import { ProductsService } from './products.service';

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
]);

export interface ImportSummary {
  total: number;
  success: number;
  failed: number;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/**
 * CSV import strategy:
 *  - the file and header are validated up front (bad file => 400, nothing written);
 *  - every row is validated; invalid rows are reported, never silently skipped;
 *  - each valid row is upserted by `code` in its own transaction (product + tags),
 *    so one bad row never leaves a half-written product nor blocks the others.
 */
@Injectable()
export class ProductsImportService {
  private readonly logger = new Logger(ProductsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async import(file: Express.Multer.File | undefined): Promise<ImportSummary> {
    const records = this.parseFile(file);
    const lookups = await this.loadLookups();

    const summary: ImportSummary = {
      total: records.length,
      success: 0,
      failed: 0,
      created: 0,
      updated: 0,
      errors: [],
    };
    const seenCodes = new Map<string, number>();
    const columns = new Set(Object.keys(records[0]?.record ?? {}));

    for (const { record, line } of records) {
      const fail = (message: string) => {
        summary.failed++;
        summary.errors.push({ row: line, message });
      };

      const parsed = parseCsvRow(record, columns, lookups);
      if (!parsed.ok) {
        fail(parsed.errors.join('; '));
        continue;
      }
      const row = parsed.data;
      const firstLine = seenCodes.get(row.code.toLowerCase());
      if (firstLine !== undefined) {
        fail(`duplicate code "${row.code}" (already used on row ${firstLine})`);
        continue;
      }
      seenCodes.set(row.code.toLowerCase(), line);

      try {
        const created = await this.upsertRow(row);
        summary.success++;
        if (created) summary.created++;
        else summary.updated++;
      } catch (err) {
        fail(err instanceof AppException ? err.message : 'database error while saving row');
        if (!(err instanceof AppException)) this.logger.error({ err, line }, 'CSV row failed');
      }
    }

    if (summary.success > 0) this.products.invalidateCatalog();
    this.logger.log(
      { total: summary.total, success: summary.success, failed: summary.failed },
      'Admin imported products from CSV',
    );
    return summary;
  }

  private parseFile(file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) {
      throw AppException.badRequest(
        ErrorCode.INVALID_FILE,
        'A non-empty CSV file is required (field "file")',
      );
    }
    if (
      !/\.csv$/i.test(file.originalname) ||
      (file.mimetype && !CSV_MIME_TYPES.has(file.mimetype))
    ) {
      throw AppException.badRequest(ErrorCode.INVALID_FILE, 'Only .csv files are accepted');
    }
    if (file.size > MAX_IMPORT_FILE_SIZE) {
      throw AppException.badRequest(ErrorCode.INVALID_FILE, 'CSV file must be at most 5 MB');
    }

    let rows: { record: Record<string, string>; info: { lines: number } }[];
    try {
      rows = parse<{ record: Record<string, string>; info: { lines: number } }>(file.buffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        bom: true,
        skip_empty_lines: true,
        info: true,
        relax_quotes: false,
        // Short rows are parsed (missing cells => empty) so they are reported per row.
        relax_column_count: true,
      });
    } catch (err) {
      throw AppException.badRequest(
        ErrorCode.INVALID_FILE,
        `CSV could not be parsed: ${(err as Error).message}`,
      );
    }

    const header = rows.length ? Object.keys(rows[0].record) : [];
    if (rows.length) {
      const missing = REQUIRED_CSV_COLUMNS.filter((c) => !header.includes(c));
      const unknown = header.filter((c) => !(CSV_COLUMNS as readonly string[]).includes(c));
      if (missing.length || unknown.length) {
        throw AppException.badRequest(
          ErrorCode.INVALID_FILE,
          [
            missing.length && `missing required column(s): ${missing.join(', ')}`,
            unknown.length && `unknown column(s): ${unknown.join(', ')}`,
          ]
            .filter(Boolean)
            .join('; '),
          { expectedColumns: CSV_COLUMNS },
        );
      }
    }
    if (!rows.length)
      throw AppException.badRequest(ErrorCode.INVALID_FILE, 'CSV file has no data rows');
    if (rows.length > MAX_IMPORT_ROWS) {
      throw AppException.badRequest(
        ErrorCode.INVALID_FILE,
        `CSV may contain at most ${MAX_IMPORT_ROWS} rows`,
      );
    }
    return rows.map((r) => ({ record: r.record, line: r.info.lines }));
  }

  private async loadLookups(): Promise<CsvLookups> {
    const [categories, tags] = await Promise.all([
      this.prisma.category.findMany({ select: { id: true, name: true, slug: true } }),
      this.prisma.tag.findMany({ select: { id: true, name: true, slug: true } }),
    ]);
    const toMap = (items: { id: bigint; name: string; slug: string }[]) => {
      const map = new Map<string, bigint>();
      for (const i of items) {
        map.set(i.slug.toLowerCase(), i.id);
        map.set(i.name.toLowerCase(), i.id);
      }
      return map;
    };
    return { categories: toMap(categories), tags: toMap(tags) };
  }

  /** Returns true when a new product was created, false when an existing one was updated. */
  private upsertRow(row: ParsedCsvRow): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { code: row.code } });

      // Re-validate the discount against the merged state when updating.
      const discountType = row.discountType ?? existing?.discountType ?? DiscountType.NONE;
      const error = validateDiscount({
        price: row.price,
        discountType,
        discountValue:
          discountType === DiscountType.NONE
            ? 0
            : (row.discountValue ?? existing?.discountValue ?? 0),
        discountStart:
          row.discountStart !== undefined ? row.discountStart : (existing?.discountStart ?? null),
        discountEnd:
          row.discountEnd !== undefined ? row.discountEnd : (existing?.discountEnd ?? null),
      });
      if (error) throw AppException.badRequest(ErrorCode.INVALID_DISCOUNT, error);

      const fields = {
        name: row.name,
        categoryId: row.categoryId,
        price: row.price,
        shortDescription: row.shortDescription,
        description: row.description,
        discountType: row.discountType,
        discountValue: row.discountValue,
        discountStart: row.discountStart,
        discountEnd: row.discountEnd,
        status: row.status,
        isActive: row.isActive,
      };

      const product = existing
        ? await tx.product.update({ where: { id: existing.id }, data: fields })
        : await tx.product.create({ data: { code: row.code, ...fields } });

      if (row.tagIds) {
        await tx.productTag.deleteMany({ where: { productId: product.id } });
        if (row.tagIds.length) {
          await tx.productTag.createMany({
            data: row.tagIds.map((tagId) => ({ productId: product.id, tagId })),
          });
        }
      }
      return !existing;
    }, INTERACTIVE_TX_OPTIONS);
  }
}
