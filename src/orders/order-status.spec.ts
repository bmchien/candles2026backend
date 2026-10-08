import { OrderStatus } from '@prisma/client';
import { allowedTransitions, canTransition, ORDER_STATUS_FLOW } from './order-status';

const { AWAITING_DEPOSIT, DEPOSITED, IN_PRODUCTION, COMPLETED, SHIPPING, DELIVERED, CANCELLED } =
  OrderStatus;

describe('order status changes (admin)', () => {
  it('covers every status, in workflow order', () => {
    expect(ORDER_STATUS_FLOW).toEqual(Object.values(OrderStatus));
  });

  it.each([
    [AWAITING_DEPOSIT, IN_PRODUCTION], // skip ahead
    [AWAITING_DEPOSIT, DELIVERED],
    [DELIVERED, IN_PRODUCTION], // back, to correct a mistake
    [IN_PRODUCTION, CANCELLED], // cancel at any time
    [SHIPPING, CANCELLED],
    [CANCELLED, AWAITING_DEPOSIT], // reopen
    [COMPLETED, SHIPPING],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('offers every other status, in workflow order', () => {
    expect(allowedTransitions(AWAITING_DEPOSIT)).toEqual([
      DEPOSITED,
      IN_PRODUCTION,
      COMPLETED,
      SHIPPING,
      DELIVERED,
      CANCELLED,
    ]);
    expect(allowedTransitions(CANCELLED)).toHaveLength(6);
  });

  it('rejects "changing" to the same status', () => {
    expect(canTransition(DEPOSITED, DEPOSITED)).toBe(false);
  });
});
