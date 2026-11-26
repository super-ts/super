/** What the order server receives. */
export type OrderRequest = { address: string; lines: { sku: string; quantity: number }[]; total: number };

export type OrderResult = { ok: true; orderId: string } | { ok: false; reason: 'payment-refused' };

/** Port (user-land): place an order. Rejects on a network failure. */
export interface OrderClient {
  place(order: OrderRequest): Promise<OrderResult>;
}
