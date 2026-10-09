import { Prisma } from '@prisma/client';
import { toDateOnly } from '../common/utils/business-date';
import { allowedTransitions } from './order-status';

export const orderInclude = {
  items: {
    orderBy: { id: 'asc' },
    // Current first image of the product, for display only (null once the product is deleted).
    include: {
      product: {
        select: {
          images: {
            select: { url: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            take: 1,
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export const adminOrderInclude = {
  ...orderInclude,
  user: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;
export type AdminOrderWithItems = Prisma.OrderGetPayload<{ include: typeof adminOrderInclude }>;

export function toOrderResponse(o: OrderWithItems) {
  return {
    id: o.id,
    status: o.status,
    shipping_method: o.shippingMethod,
    customer_name: o.customerName,
    customer_phone: o.customerPhone,
    address:
      o.shippingMethod === 'DELIVERY'
        ? {
            province_code: o.provinceCode,
            province_name: o.provinceName,
            ward_code: o.wardCode,
            ward_name: o.wardName,
            detail: o.detailAddress,
          }
        : null,
    desired_date: toDateOnly(o.desiredDate),
    total_amount: o.totalAmount,
    item_count: o.items.reduce((n, i) => n + i.quantity, 0),
    items: o.items.map((i) => ({
      id: i.id,
      product_id: i.productId,
      product_code: i.productCode,
      product_name: i.productName,
      image: i.product?.images[0]?.url ?? null,
      price: i.price,
      quantity: i.quantity,
      subtotal: i.subtotal,
      note: i.note,
    })),
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

export function toAdminOrderResponse(o: AdminOrderWithItems) {
  return {
    ...toOrderResponse(o),
    user: o.user,
    allowed_transitions: allowedTransitions(o.status),
  };
}
