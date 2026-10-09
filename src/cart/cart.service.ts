import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { calculateFinalPrice, roundMoney } from '../products/pricing';
import { PrismaService } from '../prisma/prisma.service';
import { INTERACTIVE_TX_OPTIONS } from '../prisma/transaction-options';
import {
  CartOwner,
  hashCartToken,
  newCartToken,
  ownerData,
  ownerWhere,
  userOwner,
} from './cart-owner';
import {
  AddCartItemDto,
  MAX_ITEM_QUANTITY,
  MAX_NOTE_LENGTH,
  UpdateCartItemDto,
} from './dto/cart.dto';

const cartItemInclude = {
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      price: true,
      discountType: true,
      discountValue: true,
      discountStart: true,
      discountEnd: true,
      status: true,
      isActive: true,
      images: { select: { url: true }, orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 1 },
    },
  },
} satisfies Prisma.CartItemInclude;

type CartItemWithProduct = Prisma.CartItemGetPayload<{ include: typeof cartItemInclude }>;

/** Throws when a product cannot be put in a cart (HLD §5: inactive hidden, OUT_OF_STOCK blocked). */
export function assertPurchasable(product: {
  isActive: boolean;
  status: ProductStatus;
  code?: string;
}): void {
  if (!product.isActive)
    throw AppException.notFound(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
  if (product.status === ProductStatus.OUT_OF_STOCK) {
    throw AppException.conflict(ErrorCode.PRODUCT_OUT_OF_STOCK, 'Product is out of stock');
  }
}

const NOTE_SEPARATOR = ' | ';

/** Guest carts untouched for this long are deleted (opportunistically, see cleanupGuestCarts). */
export const GUEST_CART_TTL_DAYS = 30;
const GUEST_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Adding a product again with a new note appends it to the line's note (" | "), so nothing the
 * customer wrote is lost; a repeated or empty note changes nothing. Notes are never truncated
 * silently: a result longer than MAX_NOTE_LENGTH is rejected so the customer can shorten it.
 */
export function appendNote(existing: string | null, added: string | null): string | null {
  if (!added) return existing;
  if (!existing) return added;
  if (existing.split(NOTE_SEPARATOR).includes(added)) return existing;
  const combined = `${existing}${NOTE_SEPARATOR}${added}`;
  if (combined.length > MAX_NOTE_LENGTH) {
    throw AppException.badRequest(
      ErrorCode.NOTE_TOO_LONG,
      `The product's note would exceed ${MAX_NOTE_LENGTH} characters; shorten it in the cart`,
    );
  }
  return combined;
}

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);
  private lastGuestCleanup = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** A missing owner (guest without token) simply has an empty cart. */
  async getCart(owner: CartOwner | null) {
    const cart = owner
      ? await this.prisma.cart.findUnique({
          where: ownerWhere(owner),
          include: { items: { include: cartItemInclude, orderBy: { createdAt: 'asc' } } },
        })
      : null;
    return this.toResponse(cart?.id ?? null, cart?.items ?? []);
  }

  /**
   * Adds a product. A guest without a cart token gets a new guest cart; the token is
   * returned once as `guest_token` and must be sent back in the X-Cart-Token header.
   */
  async addItem(owner: CartOwner | null, dto: AddCartItemDto) {
    const productId = BigInt(dto.productId);
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, isActive: true, status: true },
    });
    if (!product) throw AppException.notFound(ErrorCode.PRODUCT_NOT_FOUND, 'Product not found');
    assertPurchasable(product);

    let issuedToken: string | undefined;
    if (!owner) {
      issuedToken = newCartToken();
      owner = { kind: 'guest', tokenHash: hashCartToken(issuedToken) };
      void this.cleanupGuestCarts();
    }

    const cart = await this.ensureCart(owner);
    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId } },
      select: { quantity: true, note: true },
    });
    const quantity = (existing?.quantity ?? 0) + dto.quantity;
    this.assertQuantity(quantity);

    const combined = appendNote(existing?.note ?? null, dto.note ?? null);
    const note = combined !== (existing?.note ?? null) ? { note: combined } : {};
    await this.prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity, ...note },
      update: { quantity, ...note },
    });
    const response = await this.getCart(owner);
    return issuedToken ? { ...response, guest_token: issuedToken } : response;
  }

  async updateItem(owner: CartOwner | null, productId: bigint, dto: UpdateCartItemDto) {
    if (dto.quantity === undefined && dto.note === undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Send quantity and/or note',
      );
    }
    const item = await this.findItemOrThrow(owner, productId);
    if (dto.quantity !== undefined) {
      // Increasing the quantity requires the product to be purchasable; decreasing is always allowed.
      if (dto.quantity > item.quantity) assertPurchasable(item.product);
      this.assertQuantity(dto.quantity);
    }
    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: dto.quantity, note: dto.note },
    });
    return this.getCart(owner);
  }

  async removeItem(owner: CartOwner | null, productId: bigint) {
    const item = await this.findItemOrThrow(owner, productId);
    await this.prisma.cartItem.delete({ where: { id: item.id } });
    return this.getCart(owner);
  }

  async clear(owner: CartOwner | null) {
    if (owner) await this.prisma.cartItem.deleteMany({ where: { cart: ownerWhere(owner) } });
    return this.getCart(owner);
  }

  /**
   * Moves a guest cart into the user's cart after login, in one transaction. Quantities of
   * products already in the user's cart are added (capped at MAX_ITEM_QUANTITY). Products that
   * are no longer purchasable (hidden / out of stock) are skipped. The guest cart is deleted,
   * so its token can't be used again.
   *
   * Uses a fixed number of queries (4) whatever the cart size: the database is remote, so a
   * per-item loop made the transaction outlive its timeout on carts with a few items.
   */
  async mergeGuestCart(userId: bigint, guest: CartOwner | null) {
    let merged = 0;
    let skipped = 0;
    if (guest?.kind === 'guest') {
      await this.prisma.$transaction(async (tx) => {
        const guestCart = await tx.cart.findUnique({
          where: { guestTokenHash: guest.tokenHash },
          select: { id: true, _count: { select: { items: true } } },
        });
        if (!guestCart) return;
        const userCart = await tx.cart.upsert({
          where: { userId },
          create: { userId },
          update: { updatedAt: new Date() },
          select: { id: true },
        });
        // One statement: copy purchasable lines, adding to existing quantities (capped).
        merged = await tx.$executeRaw`
          INSERT INTO cart_items (cart_id, product_id, quantity, note, created_at, updated_at)
          SELECT ${userCart.id}, gi.product_id, LEAST(gi.quantity, ${MAX_ITEM_QUANTITY}), gi.note, NOW(), NOW()
          FROM cart_items gi
          JOIN products p ON p.id = gi.product_id
          WHERE gi.cart_id = ${guestCart.id}
            AND p.is_active = true
            AND p.status = 'IN_STOCK'
          ON CONFLICT (cart_id, product_id) DO UPDATE
          SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, ${MAX_ITEM_QUANTITY}),
              note = CASE
                WHEN cart_items.note IS NULL THEN EXCLUDED.note
                WHEN EXCLUDED.note IS NULL OR EXCLUDED.note = cart_items.note THEN cart_items.note
                ELSE LEFT(cart_items.note || ' | ' || EXCLUDED.note, ${MAX_NOTE_LENGTH}::int)
              END,
              updated_at = NOW()`;
        skipped = guestCart._count.items - merged;
        await tx.cart.delete({ where: { id: guestCart.id } }); // cascades to its items
      }, INTERACTIVE_TX_OPTIONS);
      if (merged || skipped) {
        this.logger.log({ userId: userId.toString(), merged, skipped }, 'Merged guest cart');
      }
    }
    return { ...(await this.getCart(userOwner(userId))), merge: { merged, skipped } };
  }

  /**
   * Deletes guest carts not touched for GUEST_CART_TTL_DAYS. Runs at most once an hour per
   * instance, piggy-backing on guest cart creation, so no scheduler is needed.
   */
  async cleanupGuestCarts(now = new Date()): Promise<number> {
    if (now.getTime() - this.lastGuestCleanup < GUEST_CLEANUP_INTERVAL_MS) return 0;
    this.lastGuestCleanup = now.getTime();
    try {
      const cutoff = new Date(now.getTime() - GUEST_CART_TTL_DAYS * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.cart.deleteMany({
        where: { userId: null, updatedAt: { lt: cutoff } },
      });
      if (count) this.logger.log({ count }, 'Deleted abandoned guest carts');
      return count;
    } catch (err) {
      this.logger.warn({ err }, 'Guest cart cleanup failed');
      return 0;
    }
  }

  /** Creates the owner's cart if needed and marks it as recently used. */
  private ensureCart(owner: CartOwner) {
    return this.prisma.cart.upsert({
      where: ownerWhere(owner),
      create: ownerData(owner),
      update: { updatedAt: new Date() },
      select: { id: true },
    });
  }

  private async findItemOrThrow(owner: CartOwner | null, productId: bigint) {
    const item = owner
      ? await this.prisma.cartItem.findFirst({
          where: { productId, cart: ownerWhere(owner) },
          select: {
            id: true,
            quantity: true,
            product: { select: { isActive: true, status: true } },
          },
        })
      : null;
    if (!item)
      throw AppException.notFound(ErrorCode.CART_ITEM_NOT_FOUND, 'Product is not in the cart');
    return item;
  }

  private assertQuantity(quantity: number) {
    if (quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        `Quantity per product must be between 1 and ${MAX_ITEM_QUANTITY}`,
      );
    }
  }

  /** All prices are computed here from current product data — never taken from the client. */
  private toResponse(cartId: bigint | null, items: CartItemWithProduct[]) {
    const now = new Date();
    let total = new Prisma.Decimal(0);
    let totalQuantity = 0;
    let hasUnavailable = false;

    const mapped = items.map((item) => {
      const p = item.product;
      const finalPrice = calculateFinalPrice(p, now);
      const subtotal = roundMoney(finalPrice.mul(item.quantity));
      const reason = !p.isActive
        ? 'INACTIVE'
        : p.status === ProductStatus.OUT_OF_STOCK
          ? 'OUT_OF_STOCK'
          : null;
      if (reason) hasUnavailable = true;
      else {
        total = total.plus(subtotal);
        totalQuantity += item.quantity;
      }
      return {
        product_id: p.id,
        product: {
          id: p.id,
          code: p.code,
          name: p.name,
          image: p.images[0]?.url ?? null,
          status: p.status,
        },
        quantity: item.quantity,
        note: item.note,
        unit_price: p.price,
        final_price: finalPrice,
        subtotal,
        available: reason === null,
        unavailable_reason: reason,
      };
    });

    return {
      id: cartId,
      items: mapped,
      total_quantity: totalQuantity,
      total: roundMoney(total),
      has_unavailable_items: hasUnavailable,
    };
  }
}
