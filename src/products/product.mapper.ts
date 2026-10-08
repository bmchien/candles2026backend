import { Prisma } from '@prisma/client';
import { calculateFinalPrice, isDiscountActive } from './pricing';

/** One include used by every product read: category, tags and ordered images in a single query. */
export const productInclude = {
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
  images: {
    select: { id: true, url: true, position: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ProductInclude;

export type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function base(p: ProductWithRelations, now: Date) {
  const finalPrice = calculateFinalPrice(p, now);
  const active = isDiscountActive(p, now);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    short_description: p.shortDescription,
    price: p.price,
    final_price: finalPrice,
    discount: {
      type: p.discountType,
      value: p.discountValue,
      start: p.discountStart,
      end: p.discountEnd,
      is_active: active,
      amount: p.price.minus(finalPrice),
    },
    category: p.category,
    tags: p.tags.map((t) => t.tag),
    images: p.images,
    status: p.status,
  };
}

export function toProductListItem(p: ProductWithRelations, now = new Date()) {
  return base(p, now);
}

export function toProductDetail(p: ProductWithRelations, now = new Date()) {
  return {
    ...base(p, now),
    description: p.description,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export function toAdminProduct(p: ProductWithRelations, now = new Date()) {
  return {
    ...toProductDetail(p, now),
    is_active: p.isActive,
    category_id: p.categoryId,
  };
}
