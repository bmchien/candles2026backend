import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma, ProductStatus, ShippingMethod } from '@prisma/client';
import { AddressService } from '../address/address.service';
import { Paginated } from '../common/dto/pagination.dto';
import { AppException } from '../common/exceptions/app.exception';
import { ErrorCode } from '../common/exceptions/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { INTERACTIVE_TX_OPTIONS } from '../prisma/transaction-options';
import { calculateFinalPrice, roundMoney } from '../products/pricing';
import {
  addDays,
  businessToday,
  fromDateOnly,
  isValidDateOnly,
} from '../common/utils/business-date';
import { CreateOrderDto, DESIRED_DATE_MAX_DAYS } from './dto/create-order.dto';
import { AdminOrderExportQueryDto, AdminOrderQueryDto, OrderQueryDto } from './dto/order-query.dto';
import { buildOrdersWorkbook, MAX_EXPORT_ORDERS } from './orders-export';
import {
  adminOrderInclude,
  orderInclude,
  toAdminOrderResponse,
  toOrderResponse,
} from './order.mapper';
import { allowedTransitions, canTransition } from './order-status';

interface ShippingAddress {
  provinceCode: string;
  provinceName: string;
  wardCode: string;
  wardName: string;
  detailAddress: string;
}

const ADDRESS_FIELDS = ['provinceCode', 'provinceName', 'wardCode', 'wardName', 'detail'] as const;

/**
 * HLD rules 13/14: PICKUP needs no address (stored as NULL); DELIVERY needs every
 * address field. Exported for unit tests; the DTO enforces the same rule at the edge.
 */
export function resolveShippingAddress(
  dto: Pick<CreateOrderDto, 'shippingMethod' | 'address'>,
): ShippingAddress | null {
  if (dto.shippingMethod === ShippingMethod.PICKUP) return null;
  const a = dto.address;
  const missing = ADDRESS_FIELDS.filter((f) => typeof a?.[f] !== 'string' || !a[f].trim());
  if (!a || missing.length) {
    throw AppException.badRequest(
      ErrorCode.INVALID_SHIPPING_ADDRESS,
      `DELIVERY requires a complete address (missing: ${missing.join(', ')})`,
    );
  }
  return {
    provinceCode: a.provinceCode.trim(),
    provinceName: a.provinceName.trim(),
    wardCode: a.wardCode.trim(),
    wardName: a.wardName.trim(),
    detailAddress: a.detail.trim(),
  };
}

/**
 * The desired receive date must be a real calendar day between today and
 * DESIRED_DATE_MAX_DAYS ahead, in Vietnam time. Exported for unit tests.
 */
export function resolveDesiredDate(value: string, now = new Date()): Date {
  const today = businessToday(now);
  const latest = addDays(today, DESIRED_DATE_MAX_DAYS);
  if (!isValidDateOnly(value) || value < today || value > latest) {
    throw AppException.badRequest(
      ErrorCode.INVALID_DESIRED_DATE,
      `desiredDate must be a date between ${today} and ${latest}`,
      { min: today, max: latest },
    );
  }
  return fromDateOnly(value);
}

/** Filters shared by the admin order list and the Excel export. */
function adminOrderWhere(query: AdminOrderExportQueryDto): Prisma.OrderWhereInput {
  return {
    status: query.status,
    shippingMethod: query.shipping_method,
    ...(query.id !== undefined && { id: BigInt(query.id) }),
    ...((query.from || query.to) && { createdAt: { gte: query.from, lte: query.to } }),
    ...(query.customer && {
      OR: [
        { customerName: { contains: query.customer, mode: 'insensitive' } },
        { customerPhone: { contains: query.customer } },
        { user: { email: { contains: query.customer, mode: 'insensitive' } } },
        { user: { name: { contains: query.customer, mode: 'insensitive' } } },
      ],
    }),
  };
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: AddressService,
  ) {}

  /**
   * Checkout. Everything from reading the cart to clearing it happens inside one
   * PostgreSQL transaction; any thrown error rolls the whole thing back, so the
   * cart is only cleared when the order and all its items were written.
   * Prices, subtotals, totals and product status are always taken from the
   * database at this moment — never from the client.
   */
  async create(userId: bigint, dto: CreateOrderDto) {
    const address = resolveShippingAddress(dto);
    const desiredDate = resolveDesiredDate(dto.desiredDate);
    if (address) await this.verifyAddress(address);

    const order = await this.prisma.$transaction(
      async (tx) => {
        // 1. Load (and lock) the user's cart so concurrent checkouts are serialised.
        const cart = await tx.cart.findUnique({ where: { userId }, select: { id: true } });
        if (!cart) throw AppException.badRequest(ErrorCode.CART_EMPTY, 'Cart is empty');
        await tx.$queryRaw`SELECT id FROM carts WHERE id = ${cart.id} FOR UPDATE`;

        // 2. Cart must not be empty.
        const items = await tx.cartItem.findMany({
          where: { cartId: cart.id },
          orderBy: { createdAt: 'asc' },
          select: { productId: true, quantity: true },
        });
        if (!items.length) throw AppException.badRequest(ErrorCode.CART_EMPTY, 'Cart is empty');

        // 3. Load products, locking them against concurrent admin edits until commit.
        const productIds = items.map((i) => i.productId);
        await tx.$queryRaw`SELECT id FROM products WHERE id IN (${Prisma.join(productIds)}) FOR SHARE`;
        const products = await tx.product.findMany({ where: { id: { in: productIds } } });
        const byId = new Map(products.map((p) => [p.id.toString(), p]));

        // 4 + 5. Re-check visibility and stock status of every product.
        const problems = items.flatMap((i) => {
          const p = byId.get(i.productId.toString());
          if (!p || !p.isActive)
            return [{ product_id: i.productId, code: p?.code ?? null, reason: 'INACTIVE' }];
          if (p.status === ProductStatus.OUT_OF_STOCK) {
            return [{ product_id: i.productId, code: p.code, reason: 'OUT_OF_STOCK' }];
          }
          return [];
        });
        if (problems.length) {
          throw AppException.conflict(
            ErrorCode.CART_HAS_UNAVAILABLE_ITEMS,
            'Some products in the cart are no longer available',
            problems,
          );
        }

        // 6. Recalculate the current final price on the server.
        const now = new Date();
        let total = new Prisma.Decimal(0);
        const lines = items.map((i) => {
          const p = byId.get(i.productId.toString())!;
          const price = calculateFinalPrice(p, now);
          const subtotal = roundMoney(price.mul(i.quantity));
          total = total.plus(subtotal);
          return {
            productId: p.id,
            productName: p.name,
            productCode: p.code,
            price, // 9. snapshot of the final price at purchase time
            quantity: i.quantity,
            subtotal,
          };
        });

        // 7 + 8 + 10. Create the order with its items and the server-computed total.
        const created = await tx.order.create({
          data: {
            userId,
            shippingMethod: dto.shippingMethod,
            customerName: dto.customerName,
            customerPhone: dto.phone,
            ...(address ?? {}),
            desiredDate,
            totalAmount: roundMoney(total),
            status: OrderStatus.AWAITING_DEPOSIT,
            items: { create: lines },
          },
          include: orderInclude,
        });

        // 11. Clear the cart (only reached when everything above succeeded).
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return created; // 12. commit
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        ...INTERACTIVE_TX_OPTIONS,
      },
    );

    this.logger.log(
      {
        orderId: order.id.toString(),
        userId: userId.toString(),
        total: order.totalAmount.toString(),
        items: order.items.length,
        shippingMethod: order.shippingMethod,
      },
      'Order created',
    );
    return toOrderResponse(order);
  }

  async listMine(userId: bigint, query: OrderQueryDto) {
    const where: Prisma.OrderWhereInput = { userId, status: query.status };
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return Paginated.of(orders.map(toOrderResponse), total, query.page, query.limit);
  }

  /** Customers can only read their own orders; someone else's order is reported as not found. */
  async getMine(userId: bigint, id: bigint) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: orderInclude,
    });
    if (!order) throw AppException.notFound(ErrorCode.ORDER_NOT_FOUND, 'Order not found');
    return toOrderResponse(order);
  }

  // ---------------------------------------------------------------- admin

  async listAdmin(query: AdminOrderQueryDto) {
    const where = adminOrderWhere(query);
    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: adminOrderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return Paginated.of(orders.map(toAdminOrderResponse), total, query.page, query.limit);
  }

  async getAdmin(id: bigint) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: adminOrderInclude });
    if (!order) throw AppException.notFound(ErrorCode.ORDER_NOT_FOUND, 'Order not found');
    return toAdminOrderResponse(order);
  }

  /**
   * Excel export of every order matching the admin filters (no pagination), oldest first.
   * Refuses more than MAX_EXPORT_ORDERS orders so one request can't exhaust memory.
   */
  async exportAdmin(query: AdminOrderExportQueryDto): Promise<Buffer> {
    const where = adminOrderWhere(query);
    const count = await this.prisma.order.count({ where });
    if (count > MAX_EXPORT_ORDERS) {
      throw AppException.badRequest(
        ErrorCode.EXPORT_TOO_LARGE,
        `${count} orders match; narrow the filters to at most ${MAX_EXPORT_ORDERS}`,
        { count, max: MAX_EXPORT_ORDERS },
      );
    }
    const orders = await this.prisma.order.findMany({
      where,
      include: adminOrderInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    this.logger.log({ count: orders.length, filters: query }, 'Admin exported orders');
    return buildOrdersWorkbook(orders);
  }

  async updateStatus(id: bigint, status: OrderStatus, adminId: bigint) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!order) throw AppException.notFound(ErrorCode.ORDER_NOT_FOUND, 'Order not found');

    if (!canTransition(order.status, status)) {
      throw AppException.badRequest(
        ErrorCode.INVALID_STATUS_TRANSITION,
        `Cannot change order status from ${order.status} to ${status}`,
        {
          from: order.status,
          to: status,
          allowed: allowedTransitions(order.status),
        },
      );
    }

    // Compare-and-set: fails if another admin changed the status in the meantime.
    const { count } = await this.prisma.order.updateMany({
      where: { id, status: order.status },
      data: { status },
    });
    if (count === 0) {
      throw AppException.conflict(
        ErrorCode.CONFLICT,
        'Order status was changed concurrently, please reload',
      );
    }

    this.logger.log(
      { orderId: id.toString(), from: order.status, to: status, adminId: adminId.toString() },
      'Admin updated order status',
    );
    return this.getAdmin(id);
  }

  private async verifyAddress(address: ShippingAddress) {
    const verified = await this.addressService.verify(address.provinceCode, address.wardCode);
    if (verified === null) {
      throw AppException.badRequest(
        ErrorCode.INVALID_SHIPPING_ADDRESS,
        'Ward does not belong to the selected province',
      );
    }
    if (verified) {
      // Use canonical names from the provider rather than client-supplied ones.
      address.provinceName = verified.provinceName;
      address.wardName = verified.wardName;
    }
  }
}
