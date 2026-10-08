import { Injectable } from '@nestjs/common';
import { OrderStatus, ProductStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { adminOrderInclude, toAdminOrderResponse } from '../orders/order.mapper';
import { REVENUE_STATUSES } from '../orders/order-status';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Dashboard figures, computed with a handful of aggregate queries (no per-row loading). */
  async getDashboard() {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const last30Days = new Date(now.getTime() - 30 * DAY_MS);

    const [
      productGroups,
      orderGroups,
      revenueTotal,
      revenue30d,
      ordersToday,
      customers,
      categories,
      tags,
      topProducts,
      recentOrders,
    ] = await Promise.all([
      this.prisma.product.groupBy({ by: ['isActive', 'status'], _count: { _all: true } }),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: [...REVENUE_STATUSES] } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: [...REVENUE_STATUSES] }, createdAt: { gte: last30Days } },
        _sum: { totalAmount: true },
      }),
      this.prisma.order.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.user.count({ where: { role: Role.CUSTOMER } }),
      this.prisma.category.count(),
      this.prisma.tag.count(),
      this.prisma.orderItem.groupBy({
        by: ['productCode', 'productName'],
        where: { order: { status: { not: OrderStatus.CANCELLED } } },
        _sum: { quantity: true, subtotal: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
      }),
      this.prisma.order.findMany({
        include: adminOrderInclude,
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const countProducts = (pred: (g: (typeof productGroups)[number]) => boolean) =>
      productGroups.filter(pred).reduce((n, g) => n + g._count._all, 0);

    const byStatus = Object.fromEntries(
      Object.values(OrderStatus).map((s) => {
        const g = orderGroups.find((x) => x.status === s);
        return [s, { count: g?._count._all ?? 0, amount: g?._sum.totalAmount ?? 0 }];
      }),
    );

    return {
      products: {
        total: countProducts(() => true),
        active: countProducts((g) => g.isActive),
        inactive: countProducts((g) => !g.isActive),
        in_stock: countProducts((g) => g.status === ProductStatus.IN_STOCK),
        out_of_stock: countProducts((g) => g.status === ProductStatus.OUT_OF_STOCK),
      },
      orders: {
        total: orderGroups.reduce((n, g) => n + g._count._all, 0),
        today: ordersToday,
        by_status: byStatus,
      },
      revenue: {
        delivered_total: revenueTotal._sum.totalAmount ?? 0,
        delivered_last_30_days: revenue30d._sum.totalAmount ?? 0,
      },
      customers: { total: customers },
      catalog: { categories, tags },
      top_products: topProducts.map((t) => ({
        product_code: t.productCode,
        product_name: t.productName,
        quantity_sold: t._sum.quantity ?? 0,
        revenue: t._sum.subtotal ?? 0,
      })),
      recent_orders: recentOrders.map(toAdminOrderResponse),
      generated_at: now,
    };
  }
}
