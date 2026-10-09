import { OrderStatus, Prisma, ShippingMethod } from '@prisma/client';
import { OrderWithItems, toOrderResponse } from './order.mapper';

function order(items: OrderWithItems['items']): OrderWithItems {
  const now = new Date('2026-10-07T00:00:00Z');
  return {
    id: 1n,
    userId: 1n,
    shippingMethod: ShippingMethod.PICKUP,
    customerName: 'An',
    customerPhone: '0912345678',
    provinceCode: null,
    provinceName: null,
    wardCode: null,
    wardName: null,
    detailAddress: null,
    totalAmount: new Prisma.Decimal(100),
    status: OrderStatus.AWAITING_DEPOSIT,
    desiredDate: new Date('2026-10-20T00:00:00Z'),
    createdAt: now,
    updatedAt: now,
    items,
  };
}

function item(id: bigint, product: OrderWithItems['items'][number]['product']) {
  return {
    id,
    orderId: 1n,
    productId: product ? 5n : null,
    productName: 'Snapshot name',
    productCode: 'SNAP-1',
    price: new Prisma.Decimal(50),
    quantity: 2,
    subtotal: new Prisma.Decimal(100),
    note: product ? 'Màu hồng, hương hoa nhài' : null,
    product,
  };
}

describe('toOrderResponse', () => {
  it('exposes the current first product image for display', () => {
    const res = toOrderResponse(order([item(1n, { images: [{ url: 'https://img.test/a.jpg' }] })]));
    expect(res.items[0]).toMatchObject({
      product_code: 'SNAP-1',
      product_name: 'Snapshot name',
      image: 'https://img.test/a.jpg',
      note: 'Màu hồng, hương hoa nhài',
    });
    expect(res.address).toBeNull();
    expect(res.desired_date).toBe('2026-10-20');
  });

  it('returns a null image when the product was deleted or has no image', () => {
    const res = toOrderResponse(order([item(1n, null), item(2n, { images: [] })]));
    expect(res.items.map((i) => i.image)).toEqual([null, null]);
    expect(res.items[0].product_id).toBeNull();
  });
});
