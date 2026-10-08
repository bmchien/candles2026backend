import { DiscountType, Prisma, ProductStatus, ShippingMethod } from '@prisma/client';
import { AddressService } from '../address/address.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService, resolveDesiredDate, resolveShippingAddress } from './orders.service';
import { addDays, businessToday } from '../common/utils/business-date';

const address = {
  provinceCode: '1',
  provinceName: 'Thành phố Hà Nội',
  wardCode: '4',
  wardName: 'Phường Ba Đình',
  detail: '12 Kim Mã',
};

const product = (overrides: Record<string, unknown> = {}) => ({
  id: 1n,
  code: 'SKU-1',
  name: 'Sản phẩm 1',
  price: new Prisma.Decimal(1_000_000),
  discountType: DiscountType.PERCENT,
  discountValue: new Prisma.Decimal(10),
  discountStart: null,
  discountEnd: null,
  status: ProductStatus.IN_STOCK,
  isActive: true,
  ...overrides,
});

describe('resolveShippingAddress', () => {
  it('PICKUP needs no address and stores NULL even if one is sent', () => {
    expect(
      resolveShippingAddress({ shippingMethod: ShippingMethod.PICKUP, address: null }),
    ).toBeNull();
    expect(resolveShippingAddress({ shippingMethod: ShippingMethod.PICKUP, address })).toBeNull();
  });

  it('DELIVERY requires an address', () => {
    expect(() =>
      resolveShippingAddress({ shippingMethod: ShippingMethod.DELIVERY, address: null }),
    ).toThrow(/DELIVERY requires a complete address/);
  });

  it('DELIVERY requires every address field', () => {
    expect(() =>
      resolveShippingAddress({
        shippingMethod: ShippingMethod.DELIVERY,
        address: { ...address, wardCode: ' ' },
      }),
    ).toThrow(/wardCode/);
  });

  it('DELIVERY maps a complete address', () => {
    expect(resolveShippingAddress({ shippingMethod: ShippingMethod.DELIVERY, address })).toEqual({
      provinceCode: '1',
      provinceName: 'Thành phố Hà Nội',
      wardCode: '4',
      wardName: 'Phường Ba Đình',
      detailAddress: '12 Kim Mã',
    });
  });
});

describe('OrdersService.create (checkout)', () => {
  let tx: {
    cart: { findUnique: jest.Mock };
    cartItem: { findMany: jest.Mock; deleteMany: jest.Mock };
    product: { findMany: jest.Mock };
    order: { create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: { $transaction: jest.Mock };
  let addressService: { verify: jest.Mock };
  let service: OrdersService;

  const dto = (overrides: Partial<CreateOrderDto> = {}): CreateOrderDto => ({
    customerName: 'Nguyễn Văn An',
    phone: '0912345678',
    shippingMethod: ShippingMethod.PICKUP,
    address: null,
    desiredDate: addDays(businessToday(), 3),
    ...overrides,
  });

  beforeEach(() => {
    tx = {
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 11n }) },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([
          { productId: 1n, quantity: 2 },
          { productId: 2n, quantity: 1 },
        ]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          product(),
          product({
            id: 2n,
            code: 'SKU-2',
            name: 'Sản phẩm 2',
            price: new Prisma.Decimal(500_000),
            discountType: DiscountType.NONE,
          }),
        ]),
      },
      order: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 100n,
          ...data,
          items: data.items.create.map((i: object, idx: number) => ({ id: BigInt(idx + 1), ...i })),
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    addressService = {
      verify: jest
        .fn()
        .mockResolvedValue({ provinceName: 'Thành phố Hà Nội', wardName: 'Phường Ba Đình' }),
    };
    service = new OrdersService(
      prisma as unknown as PrismaService,
      addressService as unknown as AddressService,
    );
  });

  it('creates a PICKUP order with server-computed prices, stores them on the items and clears the cart', async () => {
    const order = await service.create(5n, dto());

    const data = tx.order.create.mock.calls[0][0].data;
    expect(data.provinceCode).toBeUndefined();
    expect(data.status).toBe('AWAITING_DEPOSIT');
    expect((data.desiredDate as Date).toISOString().slice(0, 10)).toBe(addDays(businessToday(), 3));
    expect(data.items.create).toEqual([
      expect.objectContaining({ productCode: 'SKU-1', quantity: 2 }),
      expect.objectContaining({ productCode: 'SKU-2', quantity: 1 }),
    ]);
    // OrderItem.price is the *final* price at purchase time (10% off 1,000,000)
    expect(data.items.create[0].price.toNumber()).toBe(900_000);
    expect(data.items.create[0].subtotal.toNumber()).toBe(1_800_000);
    expect(data.items.create[1].price.toNumber()).toBe(500_000);
    expect(data.totalAmount.toNumber()).toBe(2_300_000);

    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: 11n } });
    expect(order.address).toBeNull();
    expect(order.total_amount.toNumber()).toBe(2_300_000);
    expect(addressService.verify).not.toHaveBeenCalled();
  });

  it('creates a DELIVERY order with the canonical address names', async () => {
    await service.create(
      5n,
      dto({ shippingMethod: ShippingMethod.DELIVERY, address: { ...address, provinceName: 'HN' } }),
    );
    const data = tx.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      provinceCode: '1',
      provinceName: 'Thành phố Hà Nội',
      wardCode: '4',
      detailAddress: '12 Kim Mã',
    });
  });

  it('rejects DELIVERY with an invalid ward before touching the database', async () => {
    addressService.verify.mockResolvedValue(null);
    await expect(
      service.create(5n, dto({ shippingMethod: ShippingMethod.DELIVERY, address })),
    ).rejects.toMatchObject({
      code: 'INVALID_SHIPPING_ADDRESS',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an empty cart', async () => {
    tx.cartItem.findMany.mockResolvedValue([]);
    await expect(service.create(5n, dto())).rejects.toMatchObject({ code: 'CART_EMPTY' });
    expect(tx.order.create).not.toHaveBeenCalled();
  });

  it('re-checks status: an item that went OUT_OF_STOCK aborts the order and keeps the cart', async () => {
    tx.product.findMany.mockResolvedValue([
      product(),
      product({ id: 2n, code: 'SKU-2', status: ProductStatus.OUT_OF_STOCK }),
    ]);
    await expect(service.create(5n, dto())).rejects.toMatchObject({
      status: 409,
      code: 'CART_HAS_UNAVAILABLE_ITEMS',
      details: [{ product_id: 2n, code: 'SKU-2', reason: 'OUT_OF_STOCK' }],
    });
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('re-checks visibility: an item that became inactive aborts the order', async () => {
    tx.product.findMany.mockResolvedValue([product({ isActive: false }), product({ id: 2n })]);
    await expect(service.create(5n, dto())).rejects.toMatchObject({
      code: 'CART_HAS_UNAVAILABLE_ITEMS',
    });
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('resolveDesiredDate', () => {
  // 2026-10-06 20:00 UTC is already 2026-10-07 03:00 in Vietnam
  const now = new Date('2026-10-06T20:00:00Z');

  it('accepts today (Vietnam time) up to 180 days ahead', () => {
    expect(resolveDesiredDate('2026-10-07', now).toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(resolveDesiredDate('2027-04-05', now).toISOString().slice(0, 10)).toBe('2027-04-05');
  });

  it.each(['2026-10-06', '2027-04-06', '2026-02-30', '07/10/2026', ''])(
    'rejects %p with 400 INVALID_DESIRED_DATE',
    (value) => {
      expect(() => resolveDesiredDate(value, now)).toThrow(
        expect.objectContaining({ code: 'INVALID_DESIRED_DATE' }),
      );
    },
  );
});
