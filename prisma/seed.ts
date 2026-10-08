/**
 * Development / demo seed. Idempotent: re-running updates records by their
 * unique keys (email, slug, code) instead of duplicating them.
 *
 * Credentials come from environment variables — nothing real is hard-coded:
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME (optional),
 *   SEED_CUSTOMER_PASSWORD (password for the two demo customers)
 */
import 'dotenv/config';
import {
  DiscountType,
  OrderStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  Role,
  ShippingMethod,
} from '@prisma/client';
import { hashPassword } from '../src/auth/password';
import { calculateFinalPrice, roundMoney } from '../src/products/pricing';

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysFromNow = (d: number) => new Date(now + d * DAY);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

const categories = [
  { name: 'Điện thoại', slug: 'dien-thoai' },
  { name: 'Laptop', slug: 'laptop' },
  { name: 'Phụ kiện', slug: 'phu-kien' },
  { name: 'Đồ gia dụng', slug: 'do-gia-dung' },
];

const tags = [
  { name: 'Bán chạy', slug: 'ban-chay' },
  { name: 'Hàng mới về', slug: 'hang-moi-ve' },
  { name: 'Giảm giá sốc', slug: 'giam-gia-soc' },
  { name: 'Chính hãng', slug: 'chinh-hang' },
  { name: 'Trả góp 0%', slug: 'tra-gop-0' },
  { name: 'Cao cấp', slug: 'cao-cap' },
  { name: 'Giá rẻ', slug: 'gia-re' },
  { name: 'Quà tặng', slug: 'qua-tang' },
];

interface SeedProduct {
  code: string;
  name: string;
  category: string;
  price: number;
  short: string;
  description: string;
  tags: string[];
  discount?: { type: DiscountType; value: number; start?: Date | null; end?: Date | null };
  status?: ProductStatus;
  isActive?: boolean;
}

const products: SeedProduct[] = [
  {
    code: 'IP15-128-BLK',
    name: 'iPhone 15 128GB - Đen',
    category: 'dien-thoai',
    price: 22_990_000,
    short: 'Chip A16 Bionic, camera 48MP, Dynamic Island, cổng USB-C.',
    description:
      'iPhone 15 sở hữu màn hình Super Retina XDR 6.1 inch, chip A16 Bionic mạnh mẽ, camera chính 48MP và cổng sạc USB-C. Hàng chính hãng VN/A, bảo hành 12 tháng.',
    tags: ['ban-chay', 'chinh-hang', 'tra-gop-0'],
    // Active PERCENT discount with a closed window
    discount: {
      type: DiscountType.PERCENT,
      value: 10,
      start: daysFromNow(-3),
      end: daysFromNow(14),
    },
  },
  {
    code: 'SS-S24U-256',
    name: 'Samsung Galaxy S24 Ultra 256GB',
    category: 'dien-thoai',
    price: 29_990_000,
    short: 'Bút S Pen tích hợp, camera 200MP, Galaxy AI.',
    description:
      'Galaxy S24 Ultra với khung Titan, màn hình 6.8 inch QHD+, camera 200MP zoom quang 5x và các tính năng Galaxy AI như Khoanh tròn để tìm kiếm.',
    tags: ['cao-cap', 'chinh-hang', 'tra-gop-0'],
    // Active FIXED discount
    discount: {
      type: DiscountType.FIXED,
      value: 3_000_000,
      start: daysFromNow(-1),
      end: daysFromNow(7),
    },
  },
  {
    code: 'XM-RN13-128',
    name: 'Xiaomi Redmi Note 13 128GB',
    category: 'dien-thoai',
    price: 4_890_000,
    short: 'Màn hình AMOLED 120Hz, camera 108MP, pin 5000mAh.',
    description:
      'Redmi Note 13 là lựa chọn giá tốt với màn AMOLED 6.67 inch 120Hz và sạc nhanh 33W.',
    tags: ['gia-re', 'ban-chay'],
    // Expired discount: final_price must equal price
    discount: {
      type: DiscountType.PERCENT,
      value: 15,
      start: daysFromNow(-30),
      end: daysFromNow(-2),
    },
  },
  {
    code: 'OPPO-RENO11-5G',
    name: 'OPPO Reno11 5G 256GB',
    category: 'dien-thoai',
    price: 10_490_000,
    short: 'Chuyên gia chân dung, sạc SUPERVOOC 67W.',
    description: 'OPPO Reno11 5G với camera chân dung 32MP, thiết kế mỏng nhẹ và sạc nhanh 67W.',
    tags: ['hang-moi-ve'],
    status: ProductStatus.OUT_OF_STOCK,
  },
  {
    code: 'MBA-M3-13',
    name: 'MacBook Air M3 13 inch 8GB/256GB',
    category: 'laptop',
    price: 27_990_000,
    short: 'Chip Apple M3, pin đến 18 giờ, thiết kế siêu mỏng.',
    description:
      'MacBook Air M3 mang lại hiệu năng vượt trội với chip M3 8 nhân CPU, màn hình Liquid Retina 13.6 inch và thời lượng pin lên đến 18 giờ.',
    tags: ['cao-cap', 'chinh-hang', 'tra-gop-0'],
    // Scheduled (future) discount: not applied yet
    discount: {
      type: DiscountType.FIXED,
      value: 2_000_000,
      start: daysFromNow(5),
      end: daysFromNow(20),
    },
  },
  {
    code: 'DELL-INS15-3530',
    name: 'Dell Inspiron 15 3530 i5-1335U',
    category: 'laptop',
    price: 15_490_000,
    short: 'Core i5 thế hệ 13, RAM 16GB, SSD 512GB.',
    description: 'Laptop văn phòng bền bỉ, màn hình 15.6 inch Full HD 120Hz, bàn phím có phím số.',
    tags: ['ban-chay', 'tra-gop-0'],
    // Open-ended PERCENT discount (no start/end)
    discount: { type: DiscountType.PERCENT, value: 5 },
  },
  {
    code: 'ASUS-TUF-F15',
    name: 'ASUS TUF Gaming F15 RTX 4050',
    category: 'laptop',
    price: 21_990_000,
    short: 'Laptop gaming RTX 4050, màn hình 144Hz.',
    description:
      'ASUS TUF Gaming F15 trang bị Core i5-12500H, RTX 4050 6GB, chuẩn độ bền quân đội MIL-STD-810H.',
    tags: ['hang-moi-ve'],
    status: ProductStatus.OUT_OF_STOCK,
    discount: {
      type: DiscountType.PERCENT,
      value: 8,
      start: daysFromNow(-1),
      end: daysFromNow(10),
    },
  },
  {
    code: 'LENOVO-IP-SLIM3',
    name: 'Lenovo IdeaPad Slim 3 (ngừng kinh doanh)',
    category: 'laptop',
    price: 11_990_000,
    short: 'Mẫu cũ, đã ngừng kinh doanh.',
    description: 'Sản phẩm đã ẩn khỏi cửa hàng.',
    tags: ['gia-re'],
    isActive: false,
  },
  {
    code: 'APP-AIRPODS-PRO2',
    name: 'Tai nghe AirPods Pro 2 USB-C',
    category: 'phu-kien',
    price: 5_990_000,
    short: 'Chống ồn chủ động gấp 2 lần, hộp sạc USB-C.',
    description:
      'AirPods Pro thế hệ 2 với chip H2, chế độ Xuyên âm thích ứng và âm thanh không gian cá nhân hóa.',
    tags: ['ban-chay', 'chinh-hang', 'qua-tang'],
    discount: {
      type: DiscountType.FIXED,
      value: 600_000,
      start: daysFromNow(-5),
      end: daysFromNow(5),
    },
  },
  {
    code: 'ANKER-PD-20W',
    name: 'Củ sạc nhanh Anker PowerPort III 20W',
    category: 'phu-kien',
    price: 290_000,
    short: 'Sạc nhanh PD 20W cho iPhone, nhỏ gọn.',
    description:
      'Củ sạc Anker 20W hỗ trợ Power Delivery, sạc iPhone 15 từ 0-50% trong khoảng 30 phút.',
    tags: ['gia-re', 'qua-tang'],
  },
  {
    code: 'LOGI-MX-MASTER3S',
    name: 'Chuột không dây Logitech MX Master 3S',
    category: 'phu-kien',
    price: 2_490_000,
    short: 'Cảm biến 8000 DPI, click yên tĩnh, kết nối 3 thiết bị.',
    description:
      'MX Master 3S dành cho dân văn phòng và sáng tạo, cuộn MagSpeed siêu nhanh, sạc USB-C.',
    tags: ['cao-cap'],
    discount: {
      type: DiscountType.PERCENT,
      value: 12,
      start: daysFromNow(-2),
      end: daysFromNow(3),
    },
  },
  {
    code: 'SS-CASE-S24U',
    name: 'Ốp lưng Samsung S24 Ultra (ngừng bán)',
    category: 'phu-kien',
    price: 450_000,
    short: 'Phụ kiện đã ẩn.',
    description: 'Sản phẩm đã ẩn khỏi cửa hàng.',
    tags: [],
    isActive: false,
    status: ProductStatus.OUT_OF_STOCK,
  },
  {
    code: 'SHARP-AIR-PURIFIER',
    name: 'Máy lọc không khí Sharp FP-J30E',
    category: 'do-gia-dung',
    price: 2_890_000,
    short: 'Công nghệ Plasmacluster ion, phòng đến 23m².',
    description:
      'Máy lọc không khí Sharp với màng lọc HEPA, khử mùi và diệt khuẩn bằng công nghệ Plasmacluster.',
    tags: ['chinh-hang'],
  },
  {
    code: 'PHILIPS-AIRFRYER-XL',
    name: 'Nồi chiên không dầu Philips HD9270 6.2L',
    category: 'do-gia-dung',
    price: 3_490_000,
    short: 'Dung tích 6.2 lít, công nghệ Rapid Air.',
    description:
      'Nồi chiên không dầu Philips giảm đến 90% lượng dầu mỡ, màn hình cảm ứng, 7 chế độ nấu cài sẵn.',
    tags: ['ban-chay', 'giam-gia-soc'],
    discount: {
      type: DiscountType.PERCENT,
      value: 25,
      start: daysFromNow(-1),
      end: daysFromNow(2),
    },
  },
];

async function main(): Promise<void> {
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL').toLowerCase();
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const customerPassword = requireEnv('SEED_CUSTOMER_PASSWORD');

  // ---- users
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: Role.ADMIN },
    create: {
      email: adminEmail,
      name: process.env.SEED_ADMIN_NAME || 'Quản trị viên',
      passwordHash: await hashPassword(adminPassword),
      role: Role.ADMIN,
    },
  });

  const customerHash = await hashPassword(customerPassword);
  const customers = await Promise.all(
    [
      { email: 'nguyen.van.an@example.com', name: 'Nguyễn Văn An' },
      { email: 'tran.thi.binh@example.com', name: 'Trần Thị Bình' },
    ].map((c) =>
      prisma.user.upsert({
        where: { email: c.email },
        update: {},
        create: { ...c, passwordHash: customerHash, role: Role.CUSTOMER },
      }),
    ),
  );

  // ---- categories & tags
  const categoryIds = new Map<string, bigint>();
  for (const c of categories) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: c,
    });
    categoryIds.set(c.slug, row.id);
  }
  const tagIds = new Map<string, bigint>();
  for (const t of tags) {
    const row = await prisma.tag.upsert({
      where: { slug: t.slug },
      update: { name: t.name },
      create: t,
    });
    tagIds.set(t.slug, row.id);
  }

  // ---- products (+ tags + images)
  for (const p of products) {
    const data = {
      name: p.name,
      shortDescription: p.short,
      description: p.description,
      categoryId: categoryIds.get(p.category)!,
      price: p.price,
      discountType: p.discount?.type ?? DiscountType.NONE,
      discountValue: p.discount?.value ?? 0,
      discountStart: p.discount?.start ?? null,
      discountEnd: p.discount?.end ?? null,
      status: p.status ?? ProductStatus.IN_STOCK,
      isActive: p.isActive ?? true,
    };
    const product = await prisma.product.upsert({
      where: { code: p.code },
      update: data,
      create: { code: p.code, ...data },
    });
    await prisma.$transaction([
      prisma.productTag.deleteMany({ where: { productId: product.id } }),
      prisma.productTag.createMany({
        data: p.tags.map((slug) => ({ productId: product.id, tagId: tagIds.get(slug)! })),
      }),
      prisma.productImage.deleteMany({ where: { productId: product.id } }),
      prisma.productImage.createMany({
        data: [0, 1, 2].map((i) => ({
          productId: product.id,
          url: `https://picsum.photos/seed/${p.code.toLowerCase()}-${i}/800/800`,
          position: i,
        })),
      }),
    ]);
  }

  // ---- a couple of demo orders so order history and the dashboard are not empty
  const [an] = customers;
  if ((await prisma.order.count({ where: { userId: an.id } })) === 0) {
    const pick = await prisma.product.findMany({
      where: { code: { in: ['IP15-128-BLK', 'ANKER-PD-20W', 'SHARP-AIR-PURIFIER'] } },
    });
    const line = (code: string, quantity: number) => {
      const p = pick.find((x) => x.code === code)!;
      const price = calculateFinalPrice(p);
      return {
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        price,
        quantity,
        subtotal: roundMoney(price.mul(quantity)),
      };
    };
    const sum = (items: { subtotal: Prisma.Decimal }[]) =>
      items.reduce((t, i) => t.plus(i.subtotal), new Prisma.Decimal(0));

    const delivery = [line('IP15-128-BLK', 1), line('ANKER-PD-20W', 2)];
    await prisma.order.create({
      data: {
        userId: an.id,
        shippingMethod: ShippingMethod.DELIVERY,
        customerName: an.name,
        customerPhone: '0912345678',
        provinceCode: '1',
        provinceName: 'Thành phố Hà Nội',
        wardCode: '4',
        wardName: 'Phường Ba Đình',
        detailAddress: 'Số 12 Phố Đội Cấn',
        totalAmount: sum(delivery),
        desiredDate: new Date(Date.UTC(2026, 9, 1)),
        status: OrderStatus.DELIVERED,
        items: { create: delivery },
      },
    });
    const pickup = [line('SHARP-AIR-PURIFIER', 1)];
    await prisma.order.create({
      data: {
        userId: an.id,
        shippingMethod: ShippingMethod.PICKUP,
        customerName: an.name,
        customerPhone: '0912345678',
        totalAmount: sum(pickup),
        desiredDate: new Date(Date.UTC(2026, 9, 20)),
        status: OrderStatus.AWAITING_DEPOSIT,
        items: { create: pickup },
      },
    });
  }

  console.log(
    `Seed complete: admin=${admin.email}, customers=${customers.map((c) => c.email).join(', ')}, ` +
      `${categories.length} categories, ${tags.length} tags, ${products.length} products`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
