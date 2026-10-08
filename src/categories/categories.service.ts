import { Injectable, Logger } from '@nestjs/common';
import {
  CATALOG_CACHE_PREFIX,
  CATALOG_CACHE_TTL_SECONDS,
  MemoryCacheService,
} from '../common/cache/memory-cache.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { slugify } from '../common/utils/slug';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

const categorySelect = {
  id: true,
  name: true,
  slug: true,
  _count: { select: { products: { where: { isActive: true } } } },
} as const;

type CategoryRow = { id: bigint; name: string; slug: string; _count: { products: number } };

const toResponse = (c: CategoryRow) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  product_count: c._count.products,
});

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  findAll() {
    return this.cache.wrap(
      `${CATALOG_CACHE_PREFIX}categories`,
      CATALOG_CACHE_TTL_SECONDS,
      async () => {
        const rows = await this.prisma.category.findMany({
          select: categorySelect,
          orderBy: { name: 'asc' },
        });
        // Sort in JS with Vietnamese collation (DB collation may be "C" on some hosts).
        return rows.sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(toResponse);
      },
    );
  }

  async create(dto: CreateCategoryDto) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Cannot derive a slug from name');
    await this.assertSlugAvailable(slug);
    const category = await this.prisma.category.create({
      data: { name: dto.name, slug },
      select: categorySelect,
    });
    this.afterWrite('created', category.id);
    return toResponse(category);
  }

  async update(id: bigint, dto: UpdateCategoryDto) {
    await this.findOrThrow(id);
    if (dto.slug) await this.assertSlugAvailable(dto.slug, id);
    const category = await this.prisma.category.update({
      where: { id },
      data: { name: dto.name, slug: dto.slug },
      select: categorySelect,
    });
    this.afterWrite('updated', id);
    return toResponse(category);
  }

  /** Refuses to delete a category that still has products (active or not). */
  async remove(id: bigint) {
    await this.findOrThrow(id);
    const inUse = await this.prisma.product.count({ where: { categoryId: id } });
    if (inUse > 0) {
      throw AppException.conflict(
        ErrorCode.CATEGORY_IN_USE,
        `Category is used by ${inUse} product(s); reassign them before deleting`,
      );
    }
    await this.prisma.category.delete({ where: { id } });
    this.afterWrite('deleted', id);
    return { id, deleted: true };
  }

  private async findOrThrow(id: bigint) {
    const c = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw AppException.notFound(ErrorCode.CATEGORY_NOT_FOUND, 'Category not found');
    return c;
  }

  private async assertSlugAvailable(slug: string, exceptId?: bigint) {
    const found = await this.prisma.category.findUnique({ where: { slug }, select: { id: true } });
    if (found && found.id !== exceptId) {
      throw AppException.conflict(
        ErrorCode.CATEGORY_SLUG_EXISTS,
        `Category slug "${slug}" already exists`,
      );
    }
  }

  private afterWrite(action: string, id: bigint) {
    this.cache.deleteByPrefix(CATALOG_CACHE_PREFIX);
    this.logger.log({ categoryId: id.toString() }, `Admin ${action} category`);
  }
}
