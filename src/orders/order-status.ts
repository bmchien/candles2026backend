import { OrderStatus } from '@prisma/client';

/**
 * Order workflow, in display order:
 *
 *   AWAITING_DEPOSIT → DEPOSITED → IN_PRODUCTION → COMPLETED → SHIPPING → DELIVERED   (+ CANCELLED)
 *
 * Admins may set ANY status at any time (skip ahead, go back to correct a mistake, cancel
 * or reopen); every change is logged by OrdersService.updateStatus.
 */
export const ORDER_STATUS_FLOW: readonly OrderStatus[] = [
  OrderStatus.AWAITING_DEPOSIT,
  OrderStatus.DEPOSITED,
  OrderStatus.IN_PRODUCTION,
  OrderStatus.COMPLETED,
  OrderStatus.SHIPPING,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
];

/** Vietnamese labels, used in exports. */
export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.AWAITING_DEPOSIT]: 'Chờ cọc',
  [OrderStatus.DEPOSITED]: 'Đã cọc',
  [OrderStatus.IN_PRODUCTION]: 'Đang làm',
  [OrderStatus.COMPLETED]: 'Đã hoàn thành',
  [OrderStatus.SHIPPING]: 'Đang giao',
  [OrderStatus.DELIVERED]: 'Đã giao',
  [OrderStatus.CANCELLED]: 'Huỷ',
};

/** Statuses whose orders count as revenue (fully handed over to the customer). */
export const REVENUE_STATUSES: readonly OrderStatus[] = [OrderStatus.DELIVERED];

/** Statuses an admin can switch an order to: every status except its current one. */
export function allowedTransitions(from: OrderStatus): OrderStatus[] {
  return ORDER_STATUS_FLOW.filter((to) => to !== from);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions(from).includes(to);
}
