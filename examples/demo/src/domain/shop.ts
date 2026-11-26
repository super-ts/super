/** The shop domain: catalogue, cart lines, orders. Neither Super nor DOM. */

export type Product = { sku: string; label: string; price: number };

export type CartLine = { product: Product; quantity: number; subtotal: number };

export type Order = { orderId: string; total: number };

/** The shop catalogue (prices in cents). */
export const PRODUCTS: readonly Product[] = [
  { sku: 'mug', label: 'Super mug', price: 1200 },
  { sku: 'tshirt', label: 'Super T-shirt', price: 2500 },
  { sku: 'sticker', label: 'Sticker pack', price: 400 },
];

/** The cart lines, in catalogue order, without the absent products. */
export const linesOf = (quantities: Readonly<Record<string, number>>): CartLine[] =>
  PRODUCTS.filter((p) => (quantities[p.sku] ?? 0) > 0).map((product) => {
    const quantity = quantities[product.sku]!;
    return { product, quantity, subtotal: quantity * product.price };
  });
