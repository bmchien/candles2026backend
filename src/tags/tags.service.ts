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
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';

const tagSelect = {
  id: true,
  name: true,
  slug: true,
  _count: { select: { products: { where: { product: { isActive: true } } } } },
} as const;

type TagRow = { id: bigint; name: string; slug: string; _count: { products: number } };

const toResponse = (t: TagRow) => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  product_count: t._count.products,
});

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
  ) {}

  findAll() {
    return this.cache.wrap(`${CATALOG_CACHE_PREFIX}tags`, CATALOG_CACHE_TTL_SECONDS, async () => {
      const rows = await this.prisma.tag.findMany({ select: tagSelect, orderBy: { name: 'asc' } });
      // Sort in JS with Vietnamese collation (DB collation may be "C" on some hosts).
      return rows.sort((a, b) => a.name.localeCompare(b.name, 'vi')).map(toResponse);
    });
  }

  async create(dto: CreateTagDto) {
    const slug = dto.slug ?? slugify(dto.name);
    if (!slug)
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, 'Cannot derive a slug from name');
    await this.assertUnique(dto.name, slug);
    const tag = await this.prisma.tag.create({ data: { name: dto.name, slug }, select: tagSelect });
    this.afterWrite('created', tag.id);
    return toResponse(tag);
  }

  async update(id: bigint, dto: UpdateTagDto) {
    await this.findOrThrow(id);
    await this.assertUnique(dto.name, dto.slug, id);
    const tag = await this.prisma.tag.update({
      where: { id },
      data: { name: dto.name, slug: dto.slug },
      select: tagSelect,
    });
    this.afterWrite('updated', id);
    return toResponse(tag);
  }

  /** Deleting a tag only removes its product associations (product_tags cascade). */
  async remove(id: bigint) {
    await this.findOrThrow(id);
    await this.prisma.tag.delete({ where: { id } });
    this.afterWrite('deleted', id);
    return { id, deleted: true };
  }

  private async findOrThrow(id: bigint) {
    const t = await this.prisma.tag.findUnique({ where: { id }, select: { id: true } });
    if (!t) throw AppException.notFound(ErrorCode.TAG_NOT_FOUND, 'Tag not found');
    return t;
  }

  private async assertUnique(name?: string, slug?: string, exceptId?: bigint) {
    if (!name && !slug) return;
    const clash = await this.prisma.tag.findFirst({
      where: {
        OR: [
          ...(name ? [{ name: { equals: name, mode: 'insensitive' as const } }] : []),
          ...(slug ? [{ slug }] : []),
        ],
        ...(exceptId !== undefined && { NOT: { id: exceptId } }),
      },
      select: { id: true },
    });
    if (clash)
      throw AppException.conflict(
        ErrorCode.TAG_EXISTS,
        'A tag with this name or slug already exists',
      );
  }

  private afterWrite(action: string, id: bigint) {
    this.cache.deleteByPrefix(CATALOG_CACHE_PREFIX);
    this.logger.log({ tagId: id.toString() }, `Admin ${action} tag`);
  }
}
