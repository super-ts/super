import type { OrderClient, OrderRequest, OrderResult } from '../ports/order-client';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adapter (user-land) that simulates an order server, with latency:
 * - an address containing "refuse" gets the payment refused;
 * - an address containing "offline" causes a network failure.
 */
export function createFakeOrderClient({ delay = 800 }: { delay?: number } = {}): OrderClient & { orders: OrderRequest[] } {
  const orders: OrderRequest[] = [];
  return {
    orders,
    async place(order): Promise<OrderResult> {
      await wait(delay);
      if (order.address.includes('offline')) throw new Error('Network unavailable');
      if (order.address.includes('refuse')) return { ok: false, reason: 'payment-refused' };
      orders.push(order);
      return { ok: true, orderId: `C${String(orders.length).padStart(4, '0')}` };
    },
  };
}
