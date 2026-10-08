import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CartOwner, hashCartToken, userOwner } from './cart-owner';
import { CartService } from './cart.service';

describe('CartService.addItem', () => {
  const owner = userOwner(5n);
  let prisma: {
    product: { findUnique: jest.Mock };
    cart: { upsert: jest.Mock; findUnique: jest.Mock };
    cartItem: { findUnique: jest.Mock; upsert: jest.Mock };
  };
  let service: CartService;

  beforeEach(() => {
    prisma = {
      product: { findUnique: jest.fn() },
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 1n }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      cartItem: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    };
    service = new CartService(prisma as unknown as PrismaService);
  });

  it('adds an active IN_STOCK product', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 9n,
      isActive: true,
      status: ProductStatus.IN_STOCK,
    });
    await service.addItem(owner, { productId: 9, quantity: 2 });
    expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { cartId: 1n, productId: 9n, quantity: 2 },
        update: { quantity: 2 },
      }),
    );
  });

  it('adds to the quantity already in the cart', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 9n,
      isActive: true,
      status: ProductStatus.IN_STOCK,
    });
    prisma.cartItem.findUnique.mockResolvedValue({ quantity: 3 });
    await service.addItem(owner, { productId: 9, quantity: 2 });
    expect(prisma.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { quantity: 5 } }),
    );
  });

  it('cannot add an OUT_OF_STOCK product (409 PRODUCT_OUT_OF_STOCK)', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 9n,
      isActive: true,
      status: ProductStatus.OUT_OF_STOCK,
    });
    await expect(service.addItem(owner, { productId: 9, quantity: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'PRODUCT_OUT_OF_STOCK',
    });
    expect(prisma.cartItem.upsert).not.toHaveBeenCalled();
  });

  it('cannot add an inactive product (404)', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 9n,
      isActive: false,
      status: ProductStatus.IN_STOCK,
    });
    await expect(service.addItem(owner, { productId: 9, quantity: 1 })).rejects.toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('cannot add a missing product (404)', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.addItem(owner, { productId: 9, quantity: 1 })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('caps the quantity per product', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 9n,
      isActive: true,
      status: ProductStatus.IN_STOCK,
    });
    prisma.cartItem.findUnique.mockResolvedValue({ quantity: 98 });
    await expect(service.addItem(owner, { productId: 9, quantity: 5 })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('CartService guest carts', () => {
  const inStock = { id: 9n, isActive: true, status: ProductStatus.IN_STOCK };
  let prisma: {
    product: { findUnique: jest.Mock };
    cart: { upsert: jest.Mock; findUnique: jest.Mock; deleteMany: jest.Mock };
    cartItem: { findUnique: jest.Mock; upsert: jest.Mock; findFirst: jest.Mock };
  };
  let service: CartService;

  beforeEach(() => {
    prisma = {
      product: { findUnique: jest.fn().mockResolvedValue(inStock) },
      cart: {
        upsert: jest.fn().mockResolvedValue({ id: 1n }),
        findUnique: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    service = new CartService(prisma as unknown as PrismaService);
  });

  it('issues a new guest token when a guest without token adds a product; only its hash is stored', async () => {
    const res = await service.addItem(null, { productId: 9, quantity: 1 });
    expect(res).toHaveProperty('guest_token');
    const token = (res as { guest_token: string }).guest_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prisma.cart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guestTokenHash: hashCartToken(token) },
        create: { guestTokenHash: hashCartToken(token) },
      }),
    );
  });

  it('reuses the guest cart named by the token and does not issue a new one', async () => {
    const guest: CartOwner = { kind: 'guest', tokenHash: hashCartToken('x'.repeat(43)) };
    const res = await service.addItem(guest, { productId: 9, quantity: 1 });
    expect(res).not.toHaveProperty('guest_token');
    expect(prisma.cart.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guestTokenHash: guest.kind === 'guest' && guest.tokenHash },
      }),
    );
  });

  it('guest without a cart sees an empty cart and cannot modify items', async () => {
    const empty = await service.getCart(null);
    expect(empty).toMatchObject({ id: null, items: [], total_quantity: 0 });
    expect(Number(empty.total)).toBe(0);
    await expect(service.updateItem(null, 9n, { quantity: 2 })).rejects.toMatchObject({
      status: 404,
      code: 'CART_ITEM_NOT_FOUND',
    });
  });

  it('cleans up abandoned guest carts at most once per interval', async () => {
    const now = new Date('2026-10-07T00:00:00Z');
    await service.cleanupGuestCarts(now);
    await service.cleanupGuestCarts(new Date(now.getTime() + 1000));
    expect(prisma.cart.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.cart.deleteMany).toHaveBeenCalledWith({
      where: { userId: null, updatedAt: { lt: new Date('2026-09-07T00:00:00Z') } },
    });
  });
});

describe('CartService.mergeGuestCart', () => {
  const guest: CartOwner = { kind: 'guest', tokenHash: hashCartToken('g'.repeat(43)) };
  let tx: {
    cart: { findUnique: jest.Mock; upsert: jest.Mock; delete: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let prisma: { $transaction: jest.Mock; cart: { findUnique: jest.Mock } };
  let service: CartService;

  beforeEach(() => {
    tx = {
      cart: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 2n }),
        delete: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };
    prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      cart: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new CartService(prisma as unknown as PrismaService);
  });

  it('merges all purchasable lines in one statement, reports skipped ones and deletes the guest cart', async () => {
    tx.cart.findUnique.mockResolvedValue({ id: 7n, _count: { items: 4 } });
    tx.$executeRaw.mockResolvedValue(2); // rows inserted or updated
    const res = await service.mergeGuestCart(5n, guest);

    expect(res.merge).toEqual({ merged: 2, skipped: 2 });
    expect(tx.cart.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 5n } }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = tx.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join('?');
    expect(sql).toContain('ON CONFLICT (cart_id, product_id) DO UPDATE');
    expect(sql).toContain('p.is_active = true');
    expect(sql).toContain("p.status = 'IN_STOCK'");
    expect(values).toEqual([2n, 99, 7n, 99]); // user cart, cap, guest cart, cap
    expect(tx.cart.delete).toHaveBeenCalledWith({ where: { id: 7n } });
  });

  it('runs with an explicit timeout suited to a remote database', async () => {
    tx.cart.findUnique.mockResolvedValue({ id: 7n, _count: { items: 1 } });
    tx.$executeRaw.mockResolvedValue(1);
    await service.mergeGuestCart(5n, guest);
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ timeout: 15_000 }),
    );
  });

  it('is a no-op without a known guest cart', async () => {
    tx.cart.findUnique.mockResolvedValue(null);
    const res = await service.mergeGuestCart(5n, guest);
    expect(res.merge).toEqual({ merged: 0, skipped: 0 });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.cart.delete).not.toHaveBeenCalled();
    const none = await service.mergeGuestCart(5n, null);
    expect(none.merge).toEqual({ merged: 0, skipped: 0 });
  });
});
