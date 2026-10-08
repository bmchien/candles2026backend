import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Scent, ScentType } from '@prisma/client';
import {
  CATALOG_CACHE_PREFIX,
  CATALOG_CACHE_TTL_SECONDS,
  MemoryCacheService,
} from '../common/cache/memory-cache.service';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { CreateScentDto, UpdateScentDto } from './dto/scent.dto';

/** Display order: perfume scents first, then natural ones; by name (Vietnamese collation). */
const TYPE_ORDER: Record<ScentType, number> = { PERFUME: 0, NATURAL: 1 };
const byTypeThenName = (a: Scent, b: Scent) =>
  TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.name.localeCompare(b.name, 'vi');

const toPublic = (s: Scent) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  type: s.type,
  image_url: s.imageUrl,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
});

const toAdmin = (s: Scent) => ({ ...toPublic(s), is_active: s.isActive });

@Injectable()
export class ScentsService {
  private readonly logger = new Logger(ScentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCacheService,
    private readonly uploads: UploadsService,
  ) {}

  /** Showcase page: visible scents only, optionally of one type. */
  listPublic(type?: ScentType) {
    return this.cache.wrap(
      `${CATALOG_CACHE_PREFIX}scents:${type ?? 'all'}`,
      CATALOG_CACHE_TTL_SECONDS,
      async () => {
        const rows = await this.prisma.scent.findMany({ where: { isActive: true, type } });
        return rows.sort(byTypeThenName).map(toPublic);
      },
    );
  }

  async listAdmin(type?: ScentType) {
    const rows = await this.prisma.scent.findMany({ where: { type } });
    return rows.sort(byTypeThenName).map(toAdmin);
  }

  async create(dto: CreateScentDto) {
    await this.assertNameAvailable(dto.name);
    const scent = await this.prisma.scent.create({
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        imageUrl: dto.imageUrl ?? null,
        isActive: dto.isActive ?? true,
      },
    });
    this.afterWrite('created', scent.id);
    return toAdmin(scent);
  }

  async update(id: bigint, dto: UpdateScentDto) {
    const existing = await this.findOrThrow(id);
    if (dto.name !== undefined && dto.name !== existing.name) {
      await this.assertNameAvailable(dto.name);
    }
    const scent = await this.prisma.scent.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        type: dto.type,
        imageUrl: dto.imageUrl,
        isActive: dto.isActive,
      },
    });
    // A replaced or removed uploaded image is no longer referenced: delete the file.
    if (dto.imageUrl !== undefined && existing.imageUrl && existing.imageUrl !== dto.imageUrl) {
      await this.uploads.deleteByUrl(existing.imageUrl);
    }
    this.afterWrite('updated', id);
    return toAdmin(scent);
  }

  async remove(id: bigint) {
    const existing = await this.findOrThrow(id);
    await this.prisma.scent.delete({ where: { id } });
    if (existing.imageUrl) await this.uploads.deleteByUrl(existing.imageUrl);
    this.afterWrite('deleted', id);
    return { id, deleted: true };
  }

  /** Stores an uploaded image (jpeg/png/webp/gif, checked by content) and returns its URL. */
  async uploadImage(file: Express.Multer.File | undefined) {
    if (!file) throw AppException.badRequest(ErrorCode.INVALID_FILE, 'No image file uploaded');
    return { url: await this.uploads.saveImage(file, 'scents') };
  }

  private async findOrThrow(id: bigint): Promise<Scent> {
    const scent = await this.prisma.scent.findUnique({ where: { id } });
    if (!scent) throw AppException.notFound(ErrorCode.SCENT_NOT_FOUND, 'Scent not found');
    return scent;
  }

  private async assertNameAvailable(name: string) {
    const found = await this.prisma.scent.findFirst({
      where: { name: { equals: name, mode: Prisma.QueryMode.insensitive } },
      select: { id: true },
    });
    if (found) {
      throw AppException.conflict(ErrorCode.SCENT_NAME_EXISTS, `Scent "${name}" already exists`);
    }
  }

  private afterWrite(action: string, id: bigint) {
    this.cache.deleteByPrefix(CATALOG_CACHE_PREFIX);
    this.logger.log({ scentId: id.toString() }, `Admin ${action} scent`);
  }
}
