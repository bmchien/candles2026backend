import {
  bearer,
  createTestApp,
  Fixtures,
  loginAdmin,
  resetDatabase,
  seedFixtures,
  TestContext,
} from './helpers';

type ListItem = {
  code: string;
  price: number;
  final_price: number;
  discount: { is_active: boolean; amount: number };
};
const codes = (body: { data: ListItem[] }) => body.data.map((p) => p.code).sort();

describe('Catalog: products, categories, tags (e2e)', () => {
  let ctx: TestContext;
  let fx: Fixtures;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx);
    fx = await seedFixtures(ctx);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('GET /products', () => {
    it('never returns inactive products, but does return OUT_OF_STOCK ones', async () => {
      const res = await ctx.http().get('/products?limit=100').expect(200);
      expect(res.body.pagination).toEqual({ page: 1, limit: 100, total: 6, totalPages: 1 });
      expect(codes(res.body)).not.toContain('PHONE-HIDDEN');
      expect(codes(res.body)).toContain('PHONE-OOS');
    });

    it('returns the documented list shape with server-computed prices', async () => {
      const res = await ctx.http().get('/products?q=PHONE-DISC').expect(200);
      const [p] = res.body.data;
      expect(p).toEqual({
        id: expect.any(Number),
        code: 'PHONE-DISC',
        name: 'Điện thoại giảm giá',
        short_description: 'Mô tả ngắn PHONE-DISC',
        price: 1_000_000,
        final_price: 900_000,
        discount: expect.objectContaining({
          type: 'PERCENT',
          value: 10,
          is_active: true,
          amount: 100_000,
        }),
        category: { id: expect.any(Number), name: 'Điện thoại', slug: 'dien-thoai' },
        tags: expect.arrayContaining([
          expect.objectContaining({ slug: 'ban-chay' }),
          expect.objectContaining({ slug: 'giam-gia' }),
        ]),
        images: [{ id: expect.any(Number), url: 'https://img.test/PHONE-DISC.jpg', position: 0 }],
        status: 'IN_STOCK',
      });
      expect(p).not.toHaveProperty('description');
      expect(p).not.toHaveProperty('is_active');
    });

    it('calculates FIXED and expired discounts', async () => {
      const res = await ctx.http().get('/products?limit=100').expect(200);
      const byCode = Object.fromEntries((res.body.data as ListItem[]).map((p) => [p.code, p]));
      expect(byCode['PHONE-FIXED'].final_price).toBe(300_000);
      expect(byCode['PHONE-EXPIRED'].final_price).toBe(800_000);
      expect(byCode['PHONE-EXPIRED'].discount.is_active).toBe(false);
      expect(byCode['PHONE-PLAIN'].final_price).toBe(2_000_000);
    });

    it('searches by name, by SKU/code and by tag name (case-insensitive)', async () => {
      expect(codes((await ctx.http().get('/products').query({ q: 'giảm tiền' })).body)).toEqual([
        'PHONE-FIXED',
      ]);
      expect(codes((await ctx.http().get('/products').query({ q: 'laptop-1' })).body)).toEqual([
        'LAPTOP-1',
      ]);
      expect(codes((await ctx.http().get('/products').query({ q: 'bán chạy' })).body)).toEqual([
        'PHONE-DISC',
        'PHONE-PLAIN',
      ]);
    });

    it('treats LIKE wildcards in q literally', async () => {
      expect((await ctx.http().get('/products').query({ q: '%' })).body.data).toEqual([]);
    });

    it('filters by category slug or id', async () => {
      expect(codes((await ctx.http().get('/products?category=laptop')).body)).toEqual(['LAPTOP-1']);
      expect(
        codes((await ctx.http().get(`/products?category=${fx.categories.laptop}`)).body),
      ).toEqual(['LAPTOP-1']);
      expect((await ctx.http().get('/products?category=khong-ton-tai')).body.data).toEqual([]);
    });

    it('filters by one or several tags', async () => {
      expect(codes((await ctx.http().get('/products?tag=giam-gia')).body)).toEqual([
        'PHONE-DISC',
        'PHONE-FIXED',
      ]);
      expect(codes((await ctx.http().get('/products?tag=giam-gia,ban-chay')).body)).toEqual([
        'PHONE-DISC',
        'PHONE-FIXED',
        'PHONE-PLAIN',
      ]);
    });

    it('filters by status', async () => {
      expect(codes((await ctx.http().get('/products?status=OUT_OF_STOCK')).body)).toEqual([
        'PHONE-OOS',
      ]);
    });

    it('filters products whose discount currently applies (on_sale)', async () => {
      const onSale = (await ctx.http().get('/products?on_sale=true&limit=100').expect(200)).body;
      expect(codes(onSale)).toEqual(expect.arrayContaining(['PHONE-DISC', 'PHONE-FIXED']));
      expect(codes(onSale)).not.toContain('PHONE-EXPIRED');
      expect(codes(onSale)).not.toContain('PHONE-PLAIN');
      expect((onSale.data as ListItem[]).every((p) => p.final_price < p.price)).toBe(true);
      const notOnSale = (await ctx.http().get('/products?on_sale=false&limit=100').expect(200))
        .body;
      expect(codes(notOnSale)).toEqual(expect.arrayContaining(['PHONE-EXPIRED', 'PHONE-PLAIN']));
      expect(codes(notOnSale)).not.toContain('PHONE-DISC');
      await ctx.http().get('/products?on_sale=yes').expect(400);
    });

    it('filters by the final (discounted) price range', async () => {
      // PHONE-DISC: 1,000,000 -> 900,000 ; PHONE-FIXED: 500,000 -> 300,000 ; PHONE-EXPIRED stays 800,000
      const res = await ctx.http().get('/products?min_price=300000&max_price=900000').expect(200);
      expect(codes(res.body)).toEqual(['PHONE-DISC', 'PHONE-EXPIRED', 'PHONE-FIXED']);
    });

    it('sorts by final price and paginates', async () => {
      const page1 = await ctx.http().get('/products?sort=price_asc&limit=2&page=1').expect(200);
      expect(page1.body.data.map((p: ListItem) => p.code)).toEqual([
        'PHONE-FIXED',
        'PHONE-EXPIRED',
      ]);
      expect(page1.body.pagination).toEqual({ page: 1, limit: 2, total: 6, totalPages: 3 });
      const page2 = await ctx.http().get('/products?sort=price_asc&limit=2&page=2').expect(200);
      expect(page2.body.data.map((p: ListItem) => p.code)).toEqual(['PHONE-DISC', 'PHONE-PLAIN']);
      const desc = await ctx.http().get('/products?sort=price_desc&limit=1').expect(200);
      expect(desc.body.data[0].code).toBe('LAPTOP-1');
    });

    it('validates query parameters', async () => {
      await ctx.http().get('/products?limit=0').expect(400);
      await ctx.http().get('/products?status=SOLD').expect(400);
      await ctx.http().get('/products?sort=random').expect(400);
      await ctx.http().get('/products?min_price=-1').expect(400);
    });

    it('sends HTTP cache headers', async () => {
      const res = await ctx.http().get('/products').expect(200);
      expect(res.headers['cache-control']).toMatch(/public, max-age=30/);
      expect(res.headers.etag).toBeDefined();
    });
  });

  describe('GET /products/:code', () => {
    it('returns the detail including the full description', async () => {
      const res = await ctx.http().get('/products/PHONE-DISC').expect(200);
      expect(res.body.data).toMatchObject({
        code: 'PHONE-DISC',
        description: 'Mô tả đầy đủ PHONE-DISC',
        price: 1_000_000,
        final_price: 900_000,
        status: 'IN_STOCK',
        category: { slug: 'dien-thoai' },
      });
    });

    it('returns OUT_OF_STOCK products', async () => {
      const res = await ctx.http().get('/products/PHONE-OOS').expect(200);
      expect(res.body.data.status).toBe('OUT_OF_STOCK');
    });

    it('returns 404 for inactive and unknown products', async () => {
      const res = await ctx.http().get('/products/PHONE-HIDDEN').expect(404);
      expect(res.body).toEqual({
        success: false,
        message: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
      await ctx.http().get('/products/NOPE').expect(404);
    });
  });

  describe('categories & tags', () => {
    it('GET /categories lists categories with active product counts', async () => {
      const res = await ctx.http().get('/categories').expect(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([
          { id: expect.any(Number), name: 'Laptop', slug: 'laptop', product_count: 1 },
          { id: expect.any(Number), name: 'Điện thoại', slug: 'dien-thoai', product_count: 5 },
        ]),
      );
    });

    it('GET /tags lists tags', async () => {
      const res = await ctx.http().get('/tags').expect(200);
      expect(res.body.data.map((t: { slug: string }) => t.slug).sort()).toEqual([
        'ban-chay',
        'giam-gia',
      ]);
    });

    it('admin CRUD for categories, refusing to delete one still in use', async () => {
      const admin = await loginAdmin(ctx);
      const created = await ctx
        .http()
        .post('/admin/categories')
        .set(bearer(admin))
        .send({ name: 'Phụ kiện' })
        .expect(201);
      expect(created.body.data).toMatchObject({ name: 'Phụ kiện', slug: 'phu-kien' });
      const id = created.body.data.id;

      await ctx
        .http()
        .post('/admin/categories')
        .set(bearer(admin))
        .send({ name: 'Khác', slug: 'phu-kien' })
        .expect(409);
      await ctx
        .http()
        .post('/admin/categories')
        .set(bearer(admin))
        .send({ name: 'X', slug: 'Bad Slug' })
        .expect(400);
      await ctx
        .http()
        .put(`/admin/categories/${id}`)
        .set(bearer(admin))
        .send({ name: 'Phụ kiện số' })
        .expect(200);

      const inUse = await ctx
        .http()
        .delete(`/admin/categories/${fx.categories.laptop}`)
        .set(bearer(admin))
        .expect(409);
      expect(inUse.body.code).toBe('CATEGORY_IN_USE');
      await ctx.http().delete(`/admin/categories/${id}`).set(bearer(admin)).expect(200);
      await ctx.http().delete(`/admin/categories/${id}`).set(bearer(admin)).expect(404);
    });

    it('admin CRUD for tags; deleting a tag detaches it from products', async () => {
      const admin = await loginAdmin(ctx);
      const created = await ctx
        .http()
        .post('/admin/tags')
        .set(bearer(admin))
        .send({ name: 'Flash Sale' })
        .expect(201);
      expect(created.body.data.slug).toBe('flash-sale');
      await ctx
        .http()
        .post('/admin/tags')
        .set(bearer(admin))
        .send({ name: 'flash sale' })
        .expect(409);
      await ctx
        .http()
        .put(`/admin/tags/${created.body.data.id}`)
        .set(bearer(admin))
        .send({ name: 'Siêu sale' })
        .expect(200);

      const tmp = await ctx
        .http()
        .post('/admin/tags')
        .set(bearer(admin))
        .send({ name: 'Tạm' })
        .expect(201);
      await ctx
        .http()
        .put(`/admin/products/${fx.products.plain.id}`)
        .set(bearer(admin))
        .send({ tagIds: [Number(fx.tags.hot), tmp.body.data.id] })
        .expect(200);
      await ctx.http().delete(`/admin/tags/${tmp.body.data.id}`).set(bearer(admin)).expect(200);
      const product = await ctx
        .http()
        .get(`/admin/products/${fx.products.plain.id}`)
        .set(bearer(admin))
        .expect(200);
      expect(product.body.data.tags.map((t: { slug: string }) => t.slug)).toEqual(['ban-chay']);
    });
  });

  describe('admin product listing', () => {
    it('includes inactive products and can filter by is_active', async () => {
      const admin = await loginAdmin(ctx);
      const all = await ctx.http().get('/admin/products?limit=100').set(bearer(admin)).expect(200);
      expect(all.body.pagination.total).toBe(7);
      const hidden = await ctx
        .http()
        .get('/admin/products?is_active=false')
        .set(bearer(admin))
        .expect(200);
      expect(
        hidden.body.data.map((p: { code: string; is_active: boolean }) => [p.code, p.is_active]),
      ).toEqual([['PHONE-HIDDEN', false]]);
    });
  });
});
