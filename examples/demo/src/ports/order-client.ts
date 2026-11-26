/** Ce que le serveur de commandes reçoit. */
export type OrderRequest = { address: string; lines: { sku: string; quantity: number }[]; total: number };

export type OrderResult = { ok: true; orderId: string } | { ok: false; reason: 'payment-refused' };

/** Port (user-land) : passer une commande. Rejette en cas de panne réseau. */
export interface OrderClient {
  place(order: OrderRequest): Promise<OrderResult>;
}
