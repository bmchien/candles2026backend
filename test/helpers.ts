import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DiscountType, ProductStatus, Role } from '@prisma/client';
import request from 'supertest';
import { AddressService } from '../src/address/address.service';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { MemoryCacheService } from '../src/common/cache/memory-cache.service';
import { PrismaService } from '../src/prisma/prisma.service';

export const ADMIN = { email: 'admin@test.local', password: 'Admin12345' };

/** Address provider stub: province "1" has wards "4" and "8". No network in tests. */
export const addressServiceStub = {
  getProvinces: jest.fn(async () => [{ code: '1', name: 'Thành phố Hà Nội' }]),
  getWards: jest.fn(async () => [
    { code: '4', name: 'Phường Ba Đình', province_code: '1' },
    { code: '8', name: 'Phường Ngọc Hà', province_code: '1' },
  ]),
  verify: jest.fn(async (provinceCode: string, wardCode: string) =>
    provinceCode === '1' && ['4', '8'].includes(wardCode)
      ? {
          provinceName: 'Thành phố Hà Nội',
          wardName: wardCode === '4' ? 'Phường Ba Đình' : 'Phường Ngọc Hà',
        }
      : null,
  ),
};

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AddressService)
    .useValue(addressServiceStub)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

export async function resetDatabase(ctx: TestContext): Promise<void> {
  await ctx.prisma.$executeRawUnsafe(
    'TRUNCATE TABLE order_items, orders, cart_items, carts, product_images, product_tags, products, tags, categories, users RESTART IDENTITY CASCADE',
  );
  ctx.app.get(MemoryCacheService).clear();
}

export interface Fixtures {
  categories: { phone: bigint; laptop: bigint };
  tags: { hot: bigint; sale: bigint };
  products: Record<
    'discounted' | 'fixed' | 'plain' | 'outOfStock' | 'inactive' | 'expired' | 'laptop',
    { id: bigint; code: string }
  >;
}

const DAY = 24 * 60 * 60 * 1000;

/** Small, deterministic catalog covering every visibility / stock / discount case. */
export async function seedFixtures(ctx: TestContext): Promise<Fixtures> {
  const { prisma } = ctx;
  await prisma.user.create({
    data: {
      name: 'Admin',
      email: ADMIN.email,
      passwordHash: await hashPassword(ADMIN.password),
      role: Role.ADMIN,
    },
  });
  const phone = await prisma.category.create({ data: { name: 'Điện thoại', slug: 'dien-thoai' } });
  const laptop = await prisma.category.create({ data: { name: 'Laptop', slug: 'laptop' } });
  const hot = await prisma.tag.create({ data: { name: 'Bán chạy', slug: 'ban-chay' } });
  const sale = await prisma.tag.create({ data: { name: 'Giảm giá', slug: 'giam-gia' } });

  const now = Date.now();
  const make = async (
    code: string,
    data: {
      name: string;
      price: number;
      categoryId?: bigint;
      discountType?: DiscountType;
      discountValue?: number;
      discountStart?: Date | null;
      discountEnd?: Date | null;
      status?: ProductStatus;
      isActive?: boolean;
      tags?: bigint[];
    },
  ) => {
    const { tags = [], categoryId = phone.id, ...rest } = data;
    const p = await prisma.product.create({
      data: {
        code,
        ...rest,
        categoryId,
        shortDescription: `Mô tả ngắn ${code}`,
        description: `Mô tả đầy đủ ${code}`,
        tags: { create: tags.map((tagId) => ({ tagId })) },
        images: { create: [{ url: `https://img.test/${code}.jpg`, position: 0 }] },
      },
    });
    return { id: p.id, code: p.code };
  };

  const products = {
    // 1,000,000 with an active 10% discount -> 900,000
    discounted: await make('PHONE-DISC', {
      name: 'Điện thoại giảm giá',
      price: 1_000_000,
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      discountStart: new Date(now - DAY),
      discountEnd: new Date(now + DAY),
      tags: [hot.id, sale.id],
    }),
    // 500,000 with an active FIXED 200,000 -> 300,000
    fixed: await make('PHONE-FIXED', {
      name: 'Điện thoại giảm tiền',
      price: 500_000,
      discountType: DiscountType.FIXED,
      discountValue: 200_000,
      tags: [sale.id],
    }),
    plain: await make('PHONE-PLAIN', {
      name: 'Điện thoại thường',
      price: 2_000_000,
      tags: [hot.id],
    }),
    outOfStock: await make('PHONE-OOS', {
      name: 'Điện thoại hết hàng',
      price: 3_000_000,
      status: ProductStatus.OUT_OF_STOCK,
    }),
    inactive: await make('PHONE-HIDDEN', {
      name: 'Điện thoại ẩn',
      price: 100_000,
      isActive: false,
      tags: [hot.id],
    }),
    // expired 50% discount -> final = price
    expired: await make('PHONE-EXPIRED', {
      name: 'Điện thoại hết khuyến mãi',
      price: 800_000,
      discountType: DiscountType.PERCENT,
      discountValue: 50,
      discountStart: new Date(now - 10 * DAY),
      discountEnd: new Date(now - DAY),
    }),
    laptop: await make('LAPTOP-1', {
      name: 'Laptop văn phòng',
      price: 15_000_000,
      categoryId: laptop.id,
    }),
  };

  return {
    categories: { phone: phone.id, laptop: laptop.id },
    tags: { hot: hot.id, sale: sale.id },
    products,
  };
}

export async function registerCustomer(
  ctx: TestContext,
  email: string,
  name = 'Khách Hàng',
): Promise<{ token: string; id: number }> {
  const res = await ctx
    .http()
    .post('/auth/register')
    .send({ name, email, password: 'Customer123' })
    .expect(201);
  return { token: res.body.data.access_token, id: res.body.data.user.id };
}

export async function loginAdmin(ctx: TestContext): Promise<string> {
  const res = await ctx.http().post('/auth/login').send(ADMIN).expect(200);
  return res.body.data.access_token;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
