import { Injectable, Logger } from '@nestjs/common';
import { DiscountType, Prisma } from '@prisma/client';
import {
  CATALOG_CACHE_PREFIX,
  CATALOG_CACHE_TTL_SECONDS,
  MemoryCacheService,
} from '../common/cache/memory-cache.service';
import { Paginated } from '../common/dto/pagination.dto';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { INTERACTIVE_TX_OPTIONS } from '../prisma/transaction-options';
import { CreateProductDto, ProductImageInputDto, UpdateProductDto } from './dto/create-product.dto';
import { AdminProductQueryDto, ProductQueryDto, ProductSort } from './dto/product-query.dto';
import {
  productInclude,
  ProductWithRelations,
  toAdminProduct,
  toProductDetail,
  toProductListItem,
} from './product.mapper';
import { finalPriceSql, validateDiscount } from './pricing';

type ListMode = { admin: false } | { admin: true; isActive?: boolean };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  // ---------------------------------------------------------------- public reads

  /** Storefront listing: only active products; cached for a short TTL. */
  listPublic(query: ProductQueryDto) {
    const key = `${CATALOG_CACHE_PREFIX}products:${JSON.stringify(query)}`;
    return this.cache.wrap(key, CATALOG_CACHE_TTL_SECONDS, async () => {
      const now = new Date();
      const { items, total } = await this.search(query, { admin: false }, now);
      return Paginated.of(
        items.map((p) => toProductListItem(p, now)),
        total,
        query.page,
        query.limit,
      );
    });
  }

  /** Storefront detail by SKU. Inactive products are indistinguishable from missing ones (404). */
  getPublicByCode(code: string) {
    const key = `${CATALOG_CACHE_PREFIX}product:${code}`;
    return this.cache.wrap(key, CATALOG_CACHE_TTL_SECONDS, async () => {
      const product = await this.prisma.product.findFirst({
        where: { code, isActive: true },
        include: productInclude,
      });
      if (!product) throw AppException.notFound(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
      return toProductDetail(product);
    });
  }

  // ---------------------------------------------------------------- admin reads

  async listAdmin(query: AdminProductQueryDto) {
    const now = new Date();
    const { items, total } = await this.search(
      query,
      { admin: true, isActive: query.is_active },
      now,
    );
    return Paginated.of(
      items.map((p) => toAdminProduct(p, now)),
      total,
      query.page,
      query.limit,
    );
  }

  async getAdminById(id: bigint) {
    return toAdminProduct(await this.findOrThrow(id));
  }

  // ---------------------------------------------------------------- admin writes

  async create(dto: CreateProductDto) {
    const discountType = dto.discountType ?? DiscountType.NONE;
    const discountValue = discountType === DiscountType.NONE ? 0 : (dto.discountValue ?? 0);
    this.assertValidDiscount({
      price: dto.price,
      discountType,
      discountValue,
      discountStart: dto.discountStart ?? null,
      discountEnd: dto.discountEnd ?? null,
    });
    await this.assertCategoryExists(BigInt(dto.categoryId));
    const tagIds = await this.resolveTagIds(dto.tagIds);
    await this.assertCodeAvailable(dto.code);

    const product = await this.prisma.product.create({
      data: {
        code: dto.code,
        name: dto.name,
        shortDescription: dto.shortDescription ?? null,
        description: dto.description ?? null,
        categoryId: BigInt(dto.categoryId),
        price: dto.price,
        discountType,
        discountValue,
        discountStart: dto.discountStart ?? null,
        discountEnd: dto.discountEnd ?? null,
        status: dto.status,
        isActive: dto.isActive,
        displayOrder: dto.displayOrder ?? null,
        tags: tagIds ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
        images: dto.images ? { create: this.normalizeImages(dto.images) } : undefined,
      },
      include: productInclude,
    });

    this.invalidateCatalog();
    this.logger.log(
      { productId: product.id.toString(), code: product.code },
      'Admin created product',
    );
    return toAdminProduct(product);
  }

  async update(id: bigint, dto: UpdateProductDto) {
    const existing = await this.findOrThrow(id);

    // Validate the discount against the *resulting* state, so e.g. lowering the price
    // below an existing FIXED discount is rejected.
    const discountType = dto.discountType ?? existing.discountType;
    const merged = {
      price: dto.price ?? existing.price,
      discountType,
      discountValue:
        discountType === DiscountType.NONE ? 0 : (dto.discountValue ?? existing.discountValue),
      discountStart: dto.discountStart !== undefined ? dto.discountStart : existing.discountStart,
      discountEnd: dto.discountEnd !== undefined ? dto.discountEnd : existing.discountEnd,
    };
    this.assertValidDiscount(merged);

    if (dto.categoryId !== undefined) await this.assertCategoryExists(BigInt(dto.categoryId));
    const tagIds = await this.resolveTagIds(dto.tagIds);
    if (dto.code !== undefined && dto.code !== existing.code)
      await this.assertCodeAvailable(dto.code);

    const product = await this.prisma.$transaction(async (tx) => {
      if (tagIds) {
        await tx.productTag.deleteMany({ where: { productId: id } });
        if (tagIds.length) {
          await tx.productTag.createMany({
            data: tagIds.map((tagId) => ({ productId: id, tagId })),
          });
        }
      }
      if (dto.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (dto.images.length) {
          await tx.productImage.createMany({
            data: this.normalizeImages(dto.images).map((img) => ({ ...img, productId: id })),
          });
        }
      }
      return tx.product.update({
        where: { id },
        data: {
          code: dto.code,
          name: dto.name,
          shortDescription: dto.shortDescription,
          description: dto.description,
          categoryId: dto.categoryId !== undefined ? BigInt(dto.categoryId) : undefined,
          price: dto.price,
          discountType: merged.discountType,
          discountValue: merged.discountValue,
          discountStart: merged.discountStart,
          discountEnd: merged.discountEnd,
          status: dto.status,
          isActive: dto.isActive,
          displayOrder: dto.displayOrder,
        },
        include: productInclude,
      });
    }, INTERACTIVE_TX_OPTIONS);

    this.invalidateCatalog();
    this.logger.log(
      { productId: id.toString(), fields: Object.keys(dto) },
      'Admin updated product',
    );
    return toAdminProduct(product);
  }

  async remove(id: bigint): Promise<{ id: bigint; deleted: true }> {
    const existing = await this.findOrThrow(id);
    // Order items keep their snapshot (name/code/price); product_id is set to NULL by the FK.
    await this.prisma.product.delete({ where: { id } });
    this.invalidateCatalog();
    this.logger.log({ productId: id.toString(), code: existing.code }, 'Admin deleted product');
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- images

  /** Images are URLs (set via create/update `images`); this only detaches one. */
  async removeImage(id: bigint, imageId: bigint) {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId: id },
    });
    if (!image) throw AppException.notFound(ErrorCode.IMAGE_NOT_FOUND, 'Image not found');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    this.invalidateCatalog();
    this.logger.log(
      { productId: id.toString(), imageId: imageId.toString() },
      'Admin removed product image',
    );
    return this.getAdminById(id);
  }

  // ---------------------------------------------------------------- helpers

  invalidateCatalog(): void {
    this.cache.deleteByPrefix(CATALOG_CACHE_PREFIX);
  }

  private async findOrThrow(id: bigint): Promise<ProductWithRelations> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: productInclude,
    });
    if (!product) throw AppException.notFound(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    return product;
  }

  private assertValidDiscount(input: Parameters<typeof validateDiscount>[0]): void {
    const error = validateDiscount(input);
    if (error) throw AppException.badRequest(ErrorCode.INVALID_DISCOUNT, error);
  }

  private async assertCategoryExists(id: bigint): Promise<void> {
    const found = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw AppException.badRequest(ErrorCode.CATEGORY_NOT_FOUND, 'Category not found');
  }

  private async assertCodeAvailable(code: string): Promise<void> {
    const found = await this.prisma.product.findUnique({ where: { code }, select: { id: true } });
    if (found) {
      throw AppException.conflict(
        ErrorCode.PRODUCT_CODE_EXISTS,
        `Product code "${code}" already exists`,
      );
    }
  }

  private async resolveTagIds(ids?: number[]): Promise<bigint[] | undefined> {
    if (ids === undefined) return undefined;
    const unique = [...new Set(ids)].map((id) => BigInt(id));
    if (!unique.length) return [];
    const found = await this.prisma.tag.findMany({
      where: { id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundIds = new Set(found.map((t) => t.id.toString()));
      const missing = unique.filter((id) => !foundIds.has(id.toString()));
      throw AppException.badRequest(
        ErrorCode.TAG_NOT_FOUND,
        `Tag(s) not found: ${missing.join(', ')}`,
      );
    }
    return unique;
  }

  private normalizeImages(images: ProductImageInputDto[]) {
    return images
      .map((img, i) => ({ url: img.url, position: img.position ?? i, order: i }))
      .sort((a, b) => a.position - b.position || a.order - b.order)
      .map(({ url }, i) => ({ url, position: i }));
  }

  /**
   * Two-step search to stay N+1 free and index friendly:
   *  1) a parameterised SQL query returns the page of ids (filters/sorting may use the
   *     *final* price, which only exists as an SQL expression);
   *  2) one Prisma query loads those products with category, tags and images.
   */
  private async search(
    query: ProductQueryDto,
    mode: ListMode,
    now: Date,
  ): Promise<{ items: ProductWithRelations[]; total: number }> {
    const fp = finalPriceSql(now, 'p');
    const where: Prisma.Sql[] = [];

    if (!mode.admin) where.push(Prisma.sql`p.is_active = true`);
    else if (mode.isActive !== undefined) where.push(Prisma.sql`p.is_active = ${mode.isActive}`);

    if (query.q) {
      const like = `%${escapeLike(query.q)}%`;
      where.push(Prisma.sql`(
        p.name ILIKE ${like}
        OR p.code ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
          WHERE pt.product_id = p.id AND t.name ILIKE ${like}
        )
      )`);
    }

    if (query.category) {
      where.push(
        /^\d{1,18}$/.test(query.category)
          ? Prisma.sql`p.category_id = ${BigInt(query.category)}`
          : Prisma.sql`p.category_id IN (SELECT id FROM categories WHERE slug = ${query.category})`,
      );
    }

    if (query.tag) {
      const slugs = query.tag
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (slugs.length) {
        where.push(Prisma.sql`EXISTS (
          SELECT 1 FROM product_tags pt JOIN tags t ON t.id = pt.tag_id
          WHERE pt.product_id = p.id AND t.slug IN (${Prisma.join(slugs)})
        )`);
      }
    }

    if (query.status) where.push(Prisma.sql`p.status = CAST(${query.status} AS "ProductStatus")`);
    if (query.on_sale === true) where.push(Prisma.sql`${fp} < p.price`);
    else if (query.on_sale === false) where.push(Prisma.sql`${fp} >= p.price`);
    if (query.min_price !== undefined) {
      where.push(Prisma.sql`${fp} >= CAST(${String(query.min_price)} AS NUMERIC)`);
    }
    if (query.max_price !== undefined) {
      where.push(Prisma.sql`${fp} <= CAST(${String(query.max_price)} AS NUMERIC)`);
    }

    const whereSql = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const orderSql = this.orderBy(query.sort, fp);
    const offset = (query.page - 1) * query.limit;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<{ id: bigint }[]>`
        SELECT p.id FROM products p ${whereSql} ${orderSql} LIMIT ${query.limit} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM products p ${whereSql}`,
    ]);

    const total = countRows[0]?.total ?? 0;
    if (!rows.length) return { items: [], total };

    const products = await this.prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: productInclude,
    });
    const byId = new Map(products.map((p) => [p.id.toString(), p]));
    const items = rows
      .map((r) => byId.get(r.id.toString()))
      .filter((p): p is ProductWithRelations => p !== undefined);
    return { items, total };
  }

  private orderBy(sort: ProductSort, fp: Prisma.Sql): Prisma.Sql {
    switch (sort) {
      case ProductSort.FEATURED:
        // Pinned products by the admin's number, then everything else newest first.
        return Prisma.sql`ORDER BY p.display_order ASC NULLS LAST, p.created_at DESC, p.id DESC`;
      case ProductSort.OLDEST:
        return Prisma.sql`ORDER BY p.created_at ASC, p.id ASC`;
      case ProductSort.PRICE_ASC:
        return Prisma.sql`ORDER BY ${fp} ASC, p.id ASC`;
      case ProductSort.PRICE_DESC:
        return Prisma.sql`ORDER BY ${fp} DESC, p.id DESC`;
      case ProductSort.NAME_ASC:
        return Prisma.sql`ORDER BY p.name ASC, p.id ASC`;
      case ProductSort.NAME_DESC:
        return Prisma.sql`ORDER BY p.name DESC, p.id DESC`;
      case ProductSort.NEWEST:
      default:
        return Prisma.sql`ORDER BY p.created_at DESC, p.id DESC`;
    }
  }
}
