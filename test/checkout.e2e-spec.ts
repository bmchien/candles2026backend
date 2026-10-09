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

const address = {
  provinceCode: '1',
  provinceName: 'Hà Nội (client value)',
  wardCode: '4',
  wardName: 'Ba Đình (client value)',
  detail: 'Số 12 Phố Kim Mã',
};

describe('Cart and checkout (e2e)', () => {
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

  const addToCart = (token: string, productId: bigint, quantity = 1) =>
    ctx
      .http()
      .post('/cart/items')
      .set(bearer(token))
      .send({ productId: Number(productId), quantity });

  const checkout = (token: string, body: Record<string, unknown>) =>
    ctx
      .http()
      .post('/orders')
      .set(bearer(token))
      .send({ customerName: 'Nguyễn Văn An', phone: '0912345678', desiredDate, ...body });

  const setProduct = (id: bigint, body: Record<string, unknown>) =>
    ctx.http().put(`/admin/products/${id}`).set(bearer(admin)).send(body).expect(200);

  describe('cart', () => {
    let token: string;
    beforeAll(async () => {
      ({ token } = await registerCustomer(ctx, 'cart@example.com'));
    });

    it('starts empty', async () => {
      const res = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      expect(res.body.data).toMatchObject({ items: [], total: 0, total_quantity: 0 });
    });

    it('adds products and computes unit price, final price, subtotal and total on the server', async () => {
      await addToCart(token, fx.products.discounted.id, 2).expect(201);
      const res = await addToCart(token, fx.products.fixed.id, 1).expect(201);
      expect(res.body.data.items).toEqual([
        expect.objectContaining({
          product_id: Number(fx.products.discounted.id),
          quantity: 2,
          unit_price: 1_000_000,
          final_price: 900_000,
          subtotal: 1_800_000,
          available: true,
        }),
        expect.objectContaining({
          product_id: Number(fx.products.fixed.id),
          quantity: 1,
          final_price: 300_000,
          subtotal: 300_000,
        }),
      ]);
      expect(res.body.data.total).toBe(2_100_000);
      expect(res.body.data.total_quantity).toBe(3);
    });

    it('adding the same product again increases its quantity', async () => {
      const res = await addToCart(token, fx.products.fixed.id, 2).expect(201);
      const item = res.body.data.items.find(
        (i: { product_id: number }) => i.product_id === Number(fx.products.fixed.id),
      );
      expect(item.quantity).toBe(3);
    });

    it('rejects price fields sent by the client', async () => {
      const res = await ctx
        .http()
        .post('/cart/items')
        .set(bearer(token))
        .send({ productId: Number(fx.products.plain.id), quantity: 1, price: 1 })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('cannot add an OUT_OF_STOCK product (409)', async () => {
      const res = await addToCart(token, fx.products.outOfStock.id).expect(409);
      expect(res.body.code).toBe('PRODUCT_OUT_OF_STOCK');
    });

    it('cannot add an inactive or unknown product (404)', async () => {
      expect((await addToCart(token, fx.products.inactive.id).expect(404)).body.code).toBe(
        'PRODUCT_NOT_FOUND',
      );
      await addToCart(token, 999999n).expect(404);
    });

    it('rejects quantity <= 0', async () => {
      await addToCart(token, fx.products.plain.id, 0).expect(400);
      await addToCart(token, fx.products.plain.id, -1).expect(400);
    });

    it('PUT /cart/items/:productId sets the quantity', async () => {
      const res = await ctx
        .http()
        .put(`/cart/items/${fx.products.fixed.id}`)
        .set(bearer(token))
        .send({ quantity: 1 })
        .expect(200);
      expect(res.body.data.total).toBe(2_100_000);
      await ctx
        .http()
        .put(`/cart/items/${fx.products.plain.id}`)
        .set(bearer(token))
        .send({ quantity: 1 })
        .expect(404);
      await ctx
        .http()
        .put(`/cart/items/${fx.products.fixed.id}`)
        .set(bearer(token))
        .send({ quantity: 0 })
        .expect(400);
    });

    it('DELETE /cart/items/:productId removes an item; DELETE /cart empties the cart', async () => {
      const res = await ctx
        .http()
        .delete(`/cart/items/${fx.products.fixed.id}`)
        .set(bearer(token))
        .expect(200);
      expect(res.body.data.items).toHaveLength(1);
      await ctx.http().delete(`/cart/items/${fx.products.fixed.id}`).set(bearer(token)).expect(404);
      const cleared = await ctx.http().delete('/cart').set(bearer(token)).expect(200);
      expect(cleared.body.data.items).toEqual([]);
    });

    it('carts are per user', async () => {
      const other = await registerCustomer(ctx, 'other-cart@example.com');
      await addToCart(token, fx.products.plain.id).expect(201);
      const res = await ctx.http().get('/cart').set(bearer(other.token)).expect(200);
      expect(res.body.data.items).toEqual([]);
    });

    it('flags items that became unavailable and excludes them from the total', async () => {
      await addToCart(token, fx.products.laptop.id).expect(201);
      await setProduct(fx.products.laptop.id, { status: 'OUT_OF_STOCK' });
      const res = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      const laptop = res.body.data.items.find(
        (i: { product_id: number }) => i.product_id === Number(fx.products.laptop.id),
      );
      expect(laptop).toMatchObject({ available: false, unavailable_reason: 'OUT_OF_STOCK' });
      expect(res.body.data.has_unavailable_items).toBe(true);
      expect(res.body.data.total).toBe(2_000_000);
      await setProduct(fx.products.laptop.id, { status: 'IN_STOCK' });
      await ctx.http().delete('/cart').set(bearer(token)).expect(200);
    });
  });

  describe('guest cart', () => {
    const guestAdd = (productId: bigint, quantity = 1, cartToken?: string) => {
      const req = ctx.http().post('/cart/items');
      if (cartToken) void req.set('X-Cart-Token', cartToken);
      return req.send({ productId: Number(productId), quantity });
    };

    it('works without login: issues a token once, keeps items under that token', async () => {
      const first = await guestAdd(fx.products.discounted.id, 2).expect(201);
      const guestToken: string = first.body.data.guest_token;
      expect(guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(first.body.data).toMatchObject({ total: 1_800_000, total_quantity: 2 });

      const second = await guestAdd(fx.products.fixed.id, 1, guestToken).expect(201);
      expect(second.body.data).not.toHaveProperty('guest_token');
      expect(second.body.data.items).toHaveLength(2);

      const read = await ctx.http().get('/cart').set('X-Cart-Token', guestToken).expect(200);
      expect(read.body.data.total).toBe(2_100_000);
      await ctx
        .http()
        .put(`/cart/items/${fx.products.fixed.id}`)
        .set('X-Cart-Token', guestToken)
        .send({ quantity: 3 })
        .expect(200);
      await ctx
        .http()
        .delete(`/cart/items/${fx.products.fixed.id}`)
        .set('X-Cart-Token', guestToken)
        .expect(200);

      // The token is stored hashed only.
      const row = await ctx.prisma.cart.findFirstOrThrow({ where: { userId: null } });
      expect(row.guestTokenHash).toHaveLength(64);
      expect(row.guestTokenHash).not.toBe(guestToken);
    });

    it('applies the same rules as user carts (OUT_OF_STOCK / inactive rejected)', async () => {
      await guestAdd(fx.products.outOfStock.id).expect(409);
      await guestAdd(fx.products.inactive.id).expect(404);
    });

    it('guests have an empty cart without a token and cannot check out', async () => {
      const res = await ctx.http().get('/cart').expect(200);
      expect(res.body.data).toMatchObject({ id: null, items: [], total: 0 });
      await ctx
        .http()
        .post('/orders')
        .send({ customerName: 'Khách', phone: '0912345678', shippingMethod: 'PICKUP', desiredDate })
        .expect(401);
    });

    it('merges the guest cart into the user cart after login, then the token is spent', async () => {
      const { token } = await registerCustomer(ctx, 'merge@example.com');
      await addToCart(token, fx.products.discounted.id, 1).expect(201);

      const g = await guestAdd(fx.products.discounted.id, 2).expect(201);
      const guestToken: string = g.body.data.guest_token;
      await guestAdd(fx.products.plain.id, 1, guestToken).expect(201);
      await guestAdd(fx.products.laptop.id, 1, guestToken).expect(201);
      await setProduct(fx.products.laptop.id, { status: 'OUT_OF_STOCK' });

      try {
        const merged = await ctx
          .http()
          .post('/cart/merge')
          .set(bearer(token))
          .set('X-Cart-Token', guestToken)
          .expect(200);
        expect(merged.body.data.merge).toEqual({ merged: 2, skipped: 1 });
        const byId = Object.fromEntries(
          (merged.body.data.items as { product_id: number; quantity: number }[]).map((i) => [
            i.product_id,
            i.quantity,
          ]),
        );
        expect(byId[Number(fx.products.discounted.id)]).toBe(3);
        expect(byId[Number(fx.products.plain.id)]).toBe(1);
        expect(byId[Number(fx.products.laptop.id)]).toBeUndefined();

        // A JWT always wins over a cart token, and the guest cart no longer exists.
        const asUser = await ctx
          .http()
          .get('/cart')
          .set(bearer(token))
          .set('X-Cart-Token', guestToken)
          .expect(200);
        expect(asUser.body.data.items).toHaveLength(2);
        const asGuest = await ctx.http().get('/cart').set('X-Cart-Token', guestToken).expect(200);
        expect(asGuest.body.data.items).toEqual([]);
        const again = await ctx
          .http()
          .post('/cart/merge')
          .set(bearer(token))
          .set('X-Cart-Token', guestToken)
          .expect(200);
        expect(again.body.data.merge).toEqual({ merged: 0, skipped: 0 });

        // The merged cart checks out normally.
        const order = await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
        expect(order.body.data.total_amount).toBe(4_700_000);
      } finally {
        await setProduct(fx.products.laptop.id, { status: 'IN_STOCK' });
      }
    });
  });

  describe('POST /orders', () => {
    it('copies each line note (colour, scent…) from the cart to the order', async () => {
      const { token } = await registerCustomer(ctx, 'notes@example.com');
      const added = await ctx
        .http()
        .post('/cart/items')
        .set(bearer(token))
        .send({ productId: Number(fx.products.plain.id), note: '  Màu hồng  ' })
        .expect(201);
      expect(added.body.data.items[0].note).toBe('Màu hồng');
      await ctx
        .http()
        .put(`/cart/items/${fx.products.plain.id}`)
        .set(bearer(token))
        .send({ note: 'Màu hồng, hương hoa nhài' })
        .expect(200);
      await ctx
        .http()
        .put(`/cart/items/${fx.products.plain.id}`)
        .set(bearer(token))
        .send({ note: 'x'.repeat(501) })
        .expect(400);
      const order = await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
      expect(order.body.data.items[0].note).toBe('Màu hồng, hương hoa nhài');
    });

    it('requires a desired receive date between today and 180 days ahead (Vietnam time)', async () => {
      const { token } = await registerCustomer(ctx, 'desired-date@example.com');
      await addToCart(token, fx.products.plain.id).expect(201);
      await checkout(token, { shippingMethod: 'PICKUP', desiredDate: undefined }).expect(400);
      const past = await checkout(token, {
        shippingMethod: 'PICKUP',
        desiredDate: addDays(businessToday(), -1),
      }).expect(400);
      expect(past.body.code).toBe('INVALID_DESIRED_DATE');
      await checkout(token, {
        shippingMethod: 'PICKUP',
        desiredDate: addDays(businessToday(), 181),
      }).expect(400);
      await checkout(token, { shippingMethod: 'PICKUP', desiredDate: '2026-02-30' }).expect(400);
      const ok = await checkout(token, {
        shippingMethod: 'PICKUP',
        desiredDate: businessToday(),
      }).expect(201);
      expect(ok.body.data.desired_date).toBe(businessToday());
    });

    it('PICKUP checkout: creates the order, stores purchase-time prices and clears the cart', async () => {
      const { token } = await registerCustomer(ctx, 'pickup@example.com');
      await addToCart(token, fx.products.discounted.id, 2).expect(201);
      await addToCart(token, fx.products.plain.id, 1).expect(201);

      const res = await checkout(token, { shippingMethod: 'PICKUP', totalAmount: 1 }).expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR'); // client totals are not accepted at all

      const ok = await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
      expect(ok.body.data).toMatchObject({
        status: 'AWAITING_DEPOSIT',
        desired_date: desiredDate,
        shipping_method: 'PICKUP',
        customer_name: 'Nguyễn Văn An',
        customer_phone: '0912345678',
        address: null,
        total_amount: 3_800_000,
        item_count: 3,
      });
      expect(ok.body.data.items).toEqual([
        expect.objectContaining({
          product_code: 'PHONE-DISC',
          price: 900_000,
          quantity: 2,
          subtotal: 1_800_000,
        }),
        expect.objectContaining({
          product_code: 'PHONE-PLAIN',
          price: 2_000_000,
          quantity: 1,
          subtotal: 2_000_000,
        }),
      ]);

      const row = await ctx.prisma.order.findUniqueOrThrow({
        where: { id: BigInt(ok.body.data.id) },
      });
      expect(row.provinceCode).toBeNull();
      expect(row.detailAddress).toBeNull();

      const cart = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      expect(cart.body.data.items).toEqual([]);
    });

    it('PICKUP accepts an explicit null address', async () => {
      const { token } = await registerCustomer(ctx, 'pickup-null@example.com');
      await addToCart(token, fx.products.plain.id).expect(201);
      await checkout(token, { shippingMethod: 'PICKUP', address: null }).expect(201);
    });

    it('DELIVERY requires a complete address', async () => {
      const { token } = await registerCustomer(ctx, 'delivery-validation@example.com');
      await addToCart(token, fx.products.plain.id).expect(201);

      const missing = await checkout(token, { shippingMethod: 'DELIVERY' }).expect(400);
      expect(missing.body.code).toBe('VALIDATION_ERROR');
      expect(missing.body.message).toMatch(/address is required for DELIVERY/);

      await checkout(token, { shippingMethod: 'DELIVERY', address: null }).expect(400);
      const partial = await checkout(token, {
        shippingMethod: 'DELIVERY',
        address: { ...address, wardCode: '' },
      }).expect(400);
      expect(partial.body.details).toEqual([
        { field: 'address.wardCode', errors: expect.any(Array) },
      ]);
      await checkout(token, {
        shippingMethod: 'DELIVERY',
        address: { ...address, detail: undefined },
      }).expect(400);

      const wrongWard = await checkout(token, {
        shippingMethod: 'DELIVERY',
        address: { ...address, wardCode: '999' },
      }).expect(400);
      expect(wrongWard.body.code).toBe('INVALID_SHIPPING_ADDRESS');

      await checkout(token, { shippingMethod: 'DELIVERY', address, phone: '12345' }).expect(400);
      await checkout(token, { shippingMethod: 'SHIP_BY_DRONE', address }).expect(400);

      // Nothing was ordered and the cart is untouched.
      expect(
        await ctx.prisma.order.count({
          where: {
            customerPhone: '0912345678',
            user: { email: 'delivery-validation@example.com' },
          },
        }),
      ).toBe(0);
      const cart = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      expect(cart.body.data.items).toHaveLength(1);
    });

    it('DELIVERY checkout stores the address with canonical names', async () => {
      const { token } = await registerCustomer(ctx, 'delivery@example.com');
      await addToCart(token, fx.products.fixed.id, 2).expect(201);
      const res = await checkout(token, { shippingMethod: 'DELIVERY', address }).expect(201);
      expect(res.body.data.address).toEqual({
        province_code: '1',
        province_name: 'Thành phố Hà Nội',
        ward_code: '4',
        ward_name: 'Phường Ba Đình',
        detail: 'Số 12 Phố Kim Mã',
      });
      expect(res.body.data.total_amount).toBe(600_000);
    });

    it('rejects checkout of an empty cart', async () => {
      const { token } = await registerCustomer(ctx, 'empty@example.com');
      const res = await checkout(token, { shippingMethod: 'PICKUP' }).expect(400);
      expect(res.body.code).toBe('CART_EMPTY');
    });

    it('re-validates product status at checkout and keeps the cart when it fails', async () => {
      const { token } = await registerCustomer(ctx, 'recheck@example.com');
      await addToCart(token, fx.products.laptop.id).expect(201);
      await addToCart(token, fx.products.plain.id).expect(201);
      await setProduct(fx.products.laptop.id, { status: 'OUT_OF_STOCK' });

      const res = await checkout(token, { shippingMethod: 'PICKUP' }).expect(409);
      expect(res.body.code).toBe('CART_HAS_UNAVAILABLE_ITEMS');
      expect(res.body.details).toEqual([
        { product_id: Number(fx.products.laptop.id), code: 'LAPTOP-1', reason: 'OUT_OF_STOCK' },
      ]);

      await setProduct(fx.products.laptop.id, { status: 'IN_STOCK', isActive: false });
      const hidden = await checkout(token, { shippingMethod: 'PICKUP' }).expect(409);
      expect(hidden.body.details[0].reason).toBe('INACTIVE');

      const cart = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      expect(cart.body.data.items).toHaveLength(2);
      expect(
        await ctx.prisma.order.count({ where: { user: { email: 'recheck@example.com' } } }),
      ).toBe(0);
      await setProduct(fx.products.laptop.id, { isActive: true });
    });

    it('recalculates the price at checkout time (not the price seen when adding to cart)', async () => {
      const { token } = await registerCustomer(ctx, 'reprice@example.com');
      await addToCart(token, fx.products.laptop.id).expect(201);
      await setProduct(fx.products.laptop.id, { price: 14_000_000 });
      const res = await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
      expect(res.body.data.items[0].price).toBe(14_000_000);
      await setProduct(fx.products.laptop.id, { price: 15_000_000 });
    });

    it('rolls back everything if any step of the transaction fails', async () => {
      const { token } = await registerCustomer(ctx, 'rollback@example.com');
      await addToCart(token, fx.products.plain.id, 2).expect(201);
      const ordersBefore = await ctx.prisma.order.count();
      const itemsBefore = await ctx.prisma.orderItem.count();

      // Make the final "clear cart" step fail *after* the order and its items were inserted.
      const original = ctx.prisma.$transaction.bind(ctx.prisma) as (
        ...args: unknown[]
      ) => Promise<unknown>;
      const spy = jest.spyOn(ctx.prisma, '$transaction').mockImplementationOnce(((
        fn: (tx: unknown) => Promise<unknown>,
        opts: unknown,
      ) =>
        original(async (tx: Record<string, any>) => {
          const failingTx = new Proxy(tx, {
            get(target, prop) {
              if (prop !== 'cartItem') return target[prop as string];
              return new Proxy(target.cartItem, {
                get(delegate, key) {
                  if (key === 'deleteMany')
                    return () => Promise.reject(new Error('simulated failure'));
                  const value = delegate[key];
                  return typeof value === 'function' ? value.bind(delegate) : value;
                },
              });
            },
          });
          return fn(failingTx);
        }, opts)) as never);

      const res = await checkout(token, { shippingMethod: 'PICKUP' }).expect(500);
      expect(res.body).toEqual({
        success: false,
        message: 'Internal server error',
        code: 'INTERNAL_ERROR',
        stack: expect.any(String),
      });
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();

      expect(await ctx.prisma.order.count()).toBe(ordersBefore);
      expect(await ctx.prisma.orderItem.count()).toBe(itemsBefore);
      const cart = await ctx.http().get('/cart').set(bearer(token)).expect(200);
      expect(cart.body.data.items).toEqual([expect.objectContaining({ quantity: 2 })]);

      // And the same cart can then be checked out normally.
      await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
    });

    it('two concurrent checkouts of the same cart create exactly one order', async () => {
      const { token } = await registerCustomer(ctx, 'race@example.com');
      await addToCart(token, fx.products.plain.id).expect(201);
      const results = await Promise.all([
        checkout(token, { shippingMethod: 'PICKUP' }),
        checkout(token, { shippingMethod: 'PICKUP' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await ctx.prisma.order.count({ where: { user: { email: 'race@example.com' } } })).toBe(
        1,
      );
    });
  });

  describe('order history', () => {
    it('OrderItem keeps the historical price after the product price and discount change', async () => {
      const { token } = await registerCustomer(ctx, 'history@example.com');
      await addToCart(token, fx.products.discounted.id, 1).expect(201);
      const order = await checkout(token, { shippingMethod: 'PICKUP' }).expect(201);
      expect(order.body.data.items[0].price).toBe(900_000);

      await setProduct(fx.products.discounted.id, { price: 5_000_000, discountType: 'NONE' });
      const current = await ctx.http().get(`/products/${fx.products.discounted.code}`).expect(200);
      expect(current.body.data.final_price).toBe(5_000_000);

      const res = await ctx
        .http()
        .get(`/orders/${order.body.data.id}`)
        .set(bearer(token))
        .expect(200);
      expect(res.body.data.items[0]).toMatchObject({
        price: 900_000,
        subtotal: 900_000,
        product_name: 'Điện thoại giảm giá',
      });
      expect(res.body.data.total_amount).toBe(900_000);

      // Hiding the product does not break old orders either.
      await setProduct(fx.products.discounted.id, { isActive: false });
      await ctx.http().get(`/orders/${order.body.data.id}`).set(bearer(token)).expect(200);
      await setProduct(fx.products.discounted.id, {
        isActive: true,
        price: 1_000_000,
        discountType: 'PERCENT',
        discountValue: 10,
      });
    });

    it('customers only see their own orders', async () => {
      const a = await registerCustomer(ctx, 'owner-a@example.com');
      const b = await registerCustomer(ctx, 'owner-b@example.com');
      await addToCart(a.token, fx.products.plain.id).expect(201);
      const order = await checkout(a.token, { shippingMethod: 'PICKUP' }).expect(201);

      await ctx.http().get(`/orders/${order.body.data.id}`).set(bearer(a.token)).expect(200);
      const denied = await ctx
        .http()
        .get(`/orders/${order.body.data.id}`)
        .set(bearer(b.token))
        .expect(404);
      expect(denied.body.code).toBe('ORDER_NOT_FOUND');

      const listA = await ctx.http().get('/orders').set(bearer(a.token)).expect(200);
      expect(listA.body.pagination.total).toBe(1);
      const listB = await ctx.http().get('/orders').set(bearer(b.token)).expect(200);
      expect(listB.body).toEqual({
        success: true,
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
  });
});
