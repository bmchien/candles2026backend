import { Scent, ScentType } from '@prisma/client';
import { MemoryCacheService } from '../common/cache/memory-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { ScentsService } from './scents.service';

const at = new Date('2026-10-07T00:00:00Z');
const scent = (id: bigint, name: string, type: ScentType, extra: Partial<Scent> = {}): Scent => ({
  id,
  name,
  description: `Mô tả ${name}`,
  type,
  imageUrl: null,
  isActive: true,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

describe('ScentsService', () => {
  let prisma: {
    scent: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let uploads: { deleteByUrl: jest.Mock; saveImage: jest.Mock };
  let service: ScentsService;

  beforeEach(() => {
    prisma = {
      scent: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(({ data }: { data: Partial<Scent> }) =>
          scent(1n, data.name!, data.type!, data),
        ),
        update: jest.fn(({ data }: { data: Partial<Scent> }) =>
          scent(1n, data.name ?? 'Hoa nhài', data.type ?? ScentType.NATURAL, data),
        ),
        delete: jest.fn(),
      },
    };
    uploads = {
      deleteByUrl: jest.fn(),
      saveImage: jest.fn().mockResolvedValue('http://x/uploads/scents/a.png'),
    };
    service = new ScentsService(
      prisma as unknown as PrismaService,
      new MemoryCacheService(),
      uploads as unknown as UploadsService,
    );
  });

  it('public list: only visible scents, perfume first, then by Vietnamese name', async () => {
    prisma.scent.findMany.mockResolvedValue([
      scent(1n, 'Sả chanh', ScentType.NATURAL),
      scent(2n, 'Gỗ đàn hương', ScentType.PERFUME),
      scent(3n, 'Bạc hà', ScentType.NATURAL),
    ]);
    const res = await service.listPublic();
    expect(prisma.scent.findMany).toHaveBeenCalledWith({
      where: { isActive: true, type: undefined },
    });
    expect(res.map((s) => s.name)).toEqual(['Gỗ đàn hương', 'Bạc hà', 'Sả chanh']);
    expect(res[0]).not.toHaveProperty('is_active');
  });

  it('rejects a duplicate name (case-insensitive) with 409 SCENT_NAME_EXISTS', async () => {
    prisma.scent.findFirst.mockResolvedValue({ id: 9n });
    await expect(
      service.create({ name: 'hoa nhài', description: 'x', type: ScentType.NATURAL }),
    ).rejects.toMatchObject({ status: 409, code: 'SCENT_NAME_EXISTS' });
  });

  it('creates a visible scent by default', async () => {
    const res = await service.create({
      name: 'Hoa nhài',
      description: 'Dịu',
      type: ScentType.NATURAL,
    });
    expect(prisma.scent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isActive: true, imageUrl: null }),
    });
    expect(res.is_active).toBe(true);
  });

  it('deletes the previously uploaded image when it is replaced, keeps it otherwise', async () => {
    prisma.scent.findUnique.mockResolvedValue(
      scent(1n, 'Hoa nhài', ScentType.NATURAL, { imageUrl: 'http://x/uploads/scents/old.png' }),
    );
    await service.update(1n, { isActive: false });
    expect(uploads.deleteByUrl).not.toHaveBeenCalled();
    await service.update(1n, { imageUrl: 'http://x/uploads/scents/new.png' });
    expect(uploads.deleteByUrl).toHaveBeenCalledWith('http://x/uploads/scents/old.png');
  });

  it('removing a scent deletes its image; unknown ids are 404', async () => {
    prisma.scent.findUnique.mockResolvedValueOnce(
      scent(1n, 'Hoa nhài', ScentType.NATURAL, { imageUrl: 'http://x/uploads/scents/a.png' }),
    );
    await service.remove(1n);
    expect(uploads.deleteByUrl).toHaveBeenCalledWith('http://x/uploads/scents/a.png');
    prisma.scent.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove(2n)).rejects.toMatchObject({
      status: 404,
      code: 'SCENT_NOT_FOUND',
    });
  });

  it('image upload requires a file', async () => {
    await expect(service.uploadImage(undefined)).rejects.toMatchObject({ code: 'INVALID_FILE' });
  });
});
