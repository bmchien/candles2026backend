import {
  bearer,
  createTestApp,
  Fixtures,
  loginAdmin,
  registerCustomer,
  resetDatabase,
  seedFixtures,
  TestContext,
} from './helpers';
import { addDays, businessToday } from '../src/common/utils/business-date';

const ADDRESS = {
  provinceCode: '1',
  provinceName: 'Thành phố Hà Nội',
  wardCode: '4',
  wardName: 'Phường Ba Đình',
  detail: '12 Kim Mã',
};

// Smallest valid PNG header + padding: enough for the magic-byte check.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

describe('Admin APIs (e2e)', () => {
  let ctx: TestContext;
  let fx: Fixtures;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx);
    fx = await seedFixtures(ctx);
    admin = await loginAdmin(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const desiredDate = addDays(businessToday(), 3);

  const placeOrder = async (
    email: string,
    name = 'Khách',
    shippingMethod: 'PICKUP' | 'DELIVERY' = 'PICKUP',
  ) => {
    const { token } = await registerCustomer(ctx, email, name);
    await ctx
      .http()
      .post('/cart/items')
      .set(bearer(token))
      .send({ productId: Number(fx.products.plain.id) })
      .expect(201);
    const res = await ctx
      .http()
      .post('/orders')
      .set(bearer(token))
      .send({
        customerName: name,
        phone: '0987654321',
        shippingMethod,
        desiredDate,
        ...(shippingMethod === 'DELIVERY' && { address: ADDRESS }),
      })
      .expect(201);
    return res.body.data.id as number;
  };

  const setStatus = (id: number, status: string) =>
    ctx.http().put(`/admin/orders/${id}/status`).set(bearer(admin)).send({ status });

  describe('order status', () => {
    it('lets the admin set any status: forward, skip ahead, back, cancel and reopen', async () => {
      const id = await placeOrder('flow@example.com', 'Khách', 'DELIVERY');
      const deposited = await setStatus(id, 'DEPOSITED').expect(200);
      expect(deposited.body.data).toMatchObject({
        status: 'DEPOSITED',
        allowed_transitions: [
          'AWAITING_DEPOSIT',
          'IN_PRODUCTION',
          'COMPLETED',
          'SHIPPING',
          'DELIVERED',
          'CANCELLED',
        ],
      });
      await setStatus(id, 'DELIVERED').expect(200); // skip ahead
      await setStatus(id, 'IN_PRODUCTION').expect(200); // back, to fix a mistake
      await setStatus(id, 'CANCELLED').expect(200); // cancel during production
      const reopened = await setStatus(id, 'AWAITING_DEPOSIT').expect(200); // reopen
      expect(reopened.body.data.allowed_transitions).toHaveLength(6);
    });

    it('PICKUP orders can be set to any status too', async () => {
      const id = await placeOrder('pickup-flow@example.com');
      await setStatus(id, 'SHIPPING').expect(200);
      await setStatus(id, 'DELIVERED').expect(200);
    });

    it('rejects setting the current status again with 400 INVALID_STATUS_TRANSITION', async () => {
      const id = await placeOrder('invalid@example.com');
      const same = await setStatus(id, 'AWAITING_DEPOSIT').expect(400);
      expect(same.body).toMatchObject({
        success: false,
        code: 'INVALID_STATUS_TRANSITION',
        message: 'Cannot change order status from AWAITING_DEPOSIT to AWAITING_DEPOSIT',
      });
    });

    it('validates the status value and the order id', async () => {
      const id = await placeOrder('bad-status@example.com');
      await setStatus(id, 'SHIPPED').expect(400);
      await setStatus(999999, 'DEPOSITED').expect(404);
      await ctx
        .http()
        .put('/admin/orders/abc/status')
        .set(bearer(admin))
        .send({ status: 'DEPOSITED' })
        .expect(400);
    });
  });

  describe('order listing', () => {
    it('filters by status, customer, order id and date', async () => {
      const id = await placeOrder('filter-me@example.com', 'Phạm Minh Châu');

      const byCustomer = await ctx
        .http()
        .get('/admin/orders')
        .query({ customer: 'minh châu' })
        .set(bearer(admin))
        .expect(200);
      expect(byCustomer.body.data.map((o: { id: number }) => o.id)).toEqual([id]);
      expect(byCustomer.body.data[0].user).toEqual({
        id: expect.any(Number),
        name: 'Phạm Minh Châu',
        email: 'filter-me@example.com',
        role: 'CUSTOMER',
      });

      const byEmail = await ctx
        .http()
        .get('/admin/orders')
        .query({ customer: 'filter-me@' })
        .set(bearer(admin))
        .expect(200);
      expect(byEmail.body.pagination.total).toBe(1);

      const byId = await ctx
        .http()
        .get('/admin/orders')
        .query({ id })
        .set(bearer(admin))
        .expect(200);
      expect(byId.body.data).toHaveLength(1);

      const pending = await ctx
        .http()
        .get('/admin/orders')
        .query({ status: 'AWAITING_DEPOSIT' })
        .set(bearer(admin))
        .expect(200);
      expect(
        pending.body.data.every((o: { status: string }) => o.status === 'AWAITING_DEPOSIT'),
      ).toBe(true);

      const future = await ctx
        .http()
        .get('/admin/orders')
        .query({ from: '2999-01-01' })
        .set(bearer(admin))
        .expect(200);
      expect(future.body.data).toEqual([]);
      const today = businessToday(); // plain dates are Vietnam days
      const upToToday = await ctx
        .http()
        .get('/admin/orders')
        .query({ to: today, id })
        .set(bearer(admin))
        .expect(200);
      expect(upToToday.body.data).toHaveLength(1);

      await ctx
        .http()
        .get('/admin/orders')
        .query({ from: 'yesterday' })
        .set(bearer(admin))
        .expect(400);
    });
  });

  describe('order export', () => {
    const exportOrders = (query: Record<string, string>) =>
      ctx
        .http()
        .get('/admin/orders/export')
        .query(query)
        .set(bearer(admin))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    it('returns an .xlsx of the orders matching status and date range', async () => {
      const id = await placeOrder('export@example.com', 'Khách Xuất Excel');
      const today = businessToday();
      const res = await exportOrders({ status: 'AWAITING_DEPOSIT', from: today, to: today }).expect(
        200,
      );
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="don-hang_${today}_${today}_awaiting_deposit.xlsx"`,
      );
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as ArrayBuffer);
      const rows = wb.getWorksheet('Đơn hàng')!.getSheetValues().slice(2) as unknown[][];
      const codes = rows.filter(Boolean).map((r) => r[1]);
      expect(codes).toContain(`#${String(id).padStart(6, '0')}`);
      const mine = rows.find((r) => r?.[1] === `#${String(id).padStart(6, '0')}`)!;
      expect(mine[4]).toBe('Chờ cọc');
      expect(mine[5]).toBe('Khách Xuất Excel');
    });

    it('validates filters and requires admin', async () => {
      await ctx
        .http()
        .get('/admin/orders/export')
        .query({ from: 'yesterday' })
        .set(bearer(admin))
        .expect(400);
      await ctx.http().get('/admin/orders/export').expect(401);
    });
  });

  describe('product management', () => {
    it('creates a product with tags and images, validating the discount', async () => {
      const base = {
        code: 'NEW-1',
        name: 'Sản phẩm mới',
        categoryId: Number(fx.categories.phone),
        price: 1_000_000,
        tagIds: [Number(fx.tags.hot)],
        images: [
          { url: 'https://img.test/b.jpg', position: 1 },
          { url: 'https://img.test/a.jpg', position: 0 },
        ],
      };

      const fixedTooBig = await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, discountType: 'FIXED', discountValue: 2_000_000 })
        .expect(400);
      expect(fixedTooBig.body.code).toBe('INVALID_DISCOUNT');

      await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, discountType: 'PERCENT', discountValue: 120 })
        .expect(400);
      await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({
          ...base,
          discountType: 'PERCENT',
          discountValue: 10,
          discountStart: '2026-12-31',
          discountEnd: '2026-01-01',
        })
        .expect(400);
      await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, categoryId: 99999 })
        .expect(400);
      await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, tagIds: [99999] })
        .expect(400);
      await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, price: -1 })
        .expect(400);

      const created = await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({ ...base, discountType: 'PERCENT', discountValue: 25 })
        .expect(201);
      expect(created.body.data).toMatchObject({
        code: 'NEW-1',
        price: 1_000_000,
        final_price: 750_000,
        is_active: true,
        status: 'IN_STOCK',
        tags: [expect.objectContaining({ slug: 'ban-chay' })],
        images: [
          expect.objectContaining({ url: 'https://img.test/a.jpg', position: 0 }),
          expect.objectContaining({ url: 'https://img.test/b.jpg', position: 1 }),
        ],
      });

      const dup = await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send(base)
        .expect(409);
      expect(dup.body.code).toBe('PRODUCT_CODE_EXISTS');
    });

    it('updates price/discount/status/visibility and validates the merged discount', async () => {
      const id = fx.products.fixed.id; // FIXED 200,000 on 500,000
      const tooLow = await ctx
        .http()
        .put(`/admin/products/${id}`)
        .set(bearer(admin))
        .send({ price: 100_000 })
        .expect(400);
      expect(tooLow.body.code).toBe('INVALID_DISCOUNT');

      const updated = await ctx
        .http()
        .put(`/admin/products/${id}`)
        .set(bearer(admin))
        .send({ price: 600_000, name: 'Tên mới' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        price: 600_000,
        final_price: 400_000,
        name: 'Tên mới',
      });

      const status = await ctx
        .http()
        .patch(`/admin/products/${id}/status`)
        .set(bearer(admin))
        .send({ status: 'OUT_OF_STOCK' })
        .expect(200);
      expect(status.body.data.status).toBe('OUT_OF_STOCK');
      const hidden = await ctx
        .http()
        .patch(`/admin/products/${id}/visibility`)
        .set(bearer(admin))
        .send({ isActive: false })
        .expect(200);
      expect(hidden.body.data.is_active).toBe(false);
      await ctx.http().get(`/products/${fx.products.fixed.code}`).expect(404);
      await ctx
        .http()
        .patch(`/admin/products/${id}/visibility`)
        .set(bearer(admin))
        .send({ isActive: true })
        .expect(200);
      await ctx.http().get(`/products/${fx.products.fixed.code}`).expect(200);
    });

    it('stores image URLs only (no file uploads) and removes one image', async () => {
      const id = fx.products.laptop.id;
      await ctx
        .http()
        .put(`/admin/products/${id}`)
        .set(bearer(admin))
        .send({ images: [{ url: '/uploads/products/x.png' }] })
        .expect(400);
      const res = await ctx
        .http()
        .put(`/admin/products/${id}`)
        .set(bearer(admin))
        .send({ images: [{ url: 'https://img.test/a.png' }, { url: 'https://img.test/b.png' }] })
        .expect(200);
      const [first] = res.body.data.images as { id: number }[];
      await ctx
        .http()
        .post(`/admin/products/${id}/images`)
        .set(bearer(admin))
        .attach('files', PNG, { filename: 'photo.png', contentType: 'image/png' })
        .expect(404);

      const after = await ctx
        .http()
        .delete(`/admin/products/${id}/images/${first.id}`)
        .set(bearer(admin))
        .expect(200);
      expect(after.body.data.images.map((i: { url: string }) => i.url)).toEqual([
        'https://img.test/b.png',
      ]);
      await ctx
        .http()
        .delete(`/admin/products/${id}/images/${first.id}`)
        .set(bearer(admin))
        .expect(404);
    });

    it('deleting a product keeps order history intact', async () => {
      const created = await ctx
        .http()
        .post('/admin/products')
        .set(bearer(admin))
        .send({
          code: 'TO-DELETE',
          name: 'Sẽ bị xóa',
          categoryId: Number(fx.categories.phone),
          price: 123_000,
        })
        .expect(201);
      const { token } = await registerCustomer(ctx, 'deleted-product@example.com');
      await ctx
        .http()
        .post('/cart/items')
        .set(bearer(token))
        .send({ productId: created.body.data.id })
        .expect(201);
      const order = await ctx
        .http()
        .post('/orders')
        .set(bearer(token))
        .send({ customerName: 'Khách', phone: '0987654321', shippingMethod: 'PICKUP', desiredDate })
        .expect(201);

      await ctx
        .http()
        .delete(`/admin/products/${created.body.data.id}`)
        .set(bearer(admin))
        .expect(200);
      await ctx
        .http()
        .get(`/admin/products/${created.body.data.id}`)
        .set(bearer(admin))
        .expect(404);

      const res = await ctx
        .http()
        .get(`/orders/${order.body.data.id}`)
        .set(bearer(token))
        .expect(200);
      expect(res.body.data.items[0]).toMatchObject({
        product_id: null,
        product_code: 'TO-DELETE',
        price: 123_000,
      });
    });
  });

  describe('CSV import', () => {
    const csv = [
      'code,name,short_description,description,category,price,discount_type,discount_value,discount_start,discount_end,status,is_active,tags',
      'CSV-A,Sản phẩm CSV A,Ngắn A,Dài A,dien-thoai,250000,PERCENT,20,,,IN_STOCK,true,ban-chay|Giảm giá',
      'CSV-B,"Sản phẩm, có dấu phẩy",,,Laptop,9900000,NONE,,,,OUT_OF_STOCK,false,',
      'CSV-C,Thiếu danh mục,,,khong-ton-tai,100,,,,,,,',
      'CSV-D,Giá sai,,,laptop,abc,,,,,,,',
      'CSV-E,Giảm quá giá,,,laptop,100,FIXED,500,,,,,',
      'CSV-A,Trùng mã,,,laptop,1,,,,,,,',
      'PHONE-PLAIN,Cập nhật từ CSV,,,dien-thoai,2100000,,,,,,,',
    ].join('\n');

    it('creates/updates valid rows and reports every invalid row', async () => {
      const res = await ctx
        .http()
        .post('/admin/products/import')
        .set(bearer(admin))
        .attach('file', Buffer.from(csv, 'utf8'), {
          filename: 'products.csv',
          contentType: 'text/csv',
        })
        .expect(200);

      expect(res.body.data).toEqual({
        total: 7,
        success: 3,
        failed: 4,
        created: 2,
        updated: 1,
        errors: [
          { row: 4, message: 'category "khong-ton-tai" not found' },
          { row: 5, message: expect.stringMatching(/price/) },
          { row: 6, message: 'FIXED discount_value must not exceed price' },
          { row: 7, message: 'duplicate code "CSV-A" (already used on row 2)' },
        ],
      });

      const a = await ctx.http().get('/products/CSV-A').expect(200);
      expect(a.body.data).toMatchObject({ final_price: 200_000, category: { slug: 'dien-thoai' } });
      expect(a.body.data.tags.map((t: { slug: string }) => t.slug).sort()).toEqual([
        'ban-chay',
        'giam-gia',
      ]);

      await ctx.http().get('/products/CSV-B').expect(404); // imported as inactive
      const b = await ctx.prisma.product.findUniqueOrThrow({ where: { code: 'CSV-B' } });
      expect(b).toMatchObject({
        name: 'Sản phẩm, có dấu phẩy',
        status: 'OUT_OF_STOCK',
        isActive: false,
      });

      const updated = await ctx.http().get('/products/PHONE-PLAIN').expect(200);
      expect(updated.body.data).toMatchObject({ name: 'Cập nhật từ CSV', price: 2_100_000 });
    });

    it('rejects files that are not valid CSV uploads', async () => {
      await ctx.http().post('/admin/products/import').set(bearer(admin)).expect(400);
      await ctx
        .http()
        .post('/admin/products/import')
        .set(bearer(admin))
        .attach('file', PNG, { filename: 'image.png', contentType: 'image/png' })
        .expect(400);
      const missingColumns = await ctx
        .http()
        .post('/admin/products/import')
        .set(bearer(admin))
        .attach('file', Buffer.from('code,name\nX,Y\n'), {
          filename: 'p.csv',
          contentType: 'text/csv',
        })
        .expect(400);
      expect(missingColumns.body.message).toMatch(/missing required column\(s\): category, price/);
      await ctx
        .http()
        .post('/admin/products/import')
        .set(bearer(admin))
        .attach('file', Buffer.from('code,name,category,price\n'), {
          filename: 'p.csv',
          contentType: 'text/csv',
        })
        .expect(400);
    });
  });

  describe('dashboard', () => {
    it('returns aggregate statistics', async () => {
      const res = await ctx.http().get('/admin/dashboard').set(bearer(admin)).expect(200);
      expect(res.body.data).toMatchObject({
        products: {
          total: expect.any(Number),
          active: expect.any(Number),
          out_of_stock: expect.any(Number),
        },
        orders: {
          total: expect.any(Number),
          by_status: expect.objectContaining({ DELIVERED: expect.any(Object) }),
        },
        revenue: { delivered_total: expect.any(Number) },
        customers: { total: expect.any(Number) },
      });
      expect(res.body.data.orders.by_status.DELIVERED.count).toBeGreaterThanOrEqual(1);
      expect(res.body.data.recent_orders.length).toBeGreaterThan(0);
    });
  });
});
