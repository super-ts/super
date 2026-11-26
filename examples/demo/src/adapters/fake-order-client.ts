import type { OrderClient, OrderRequest, OrderResult } from '../ports/order-client';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Adapter (user-land) qui simule un serveur de commandes, avec de la latence :
 * - une adresse qui contient « refus » fait refuser le paiement ;
 * - une adresse qui contient « offline » provoque une panne réseau.
 */
export function createFakeOrderClient({ delay = 800 }: { delay?: number } = {}): OrderClient & { orders: OrderRequest[] } {
  const orders: OrderRequest[] = [];
  return {
    orders,
    async place(order): Promise<OrderResult> {
      await wait(delay);
      if (order.address.includes('offline')) throw new Error('Réseau indisponible');
      if (order.address.includes('refus')) return { ok: false, reason: 'payment-refused' };
      orders.push(order);
      return { ok: true, orderId: `C${String(orders.length).padStart(4, '0')}` };
    },
  };
}
