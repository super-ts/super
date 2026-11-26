/** Le métier de la boutique : catalogue, lignes de panier, commandes. Ni Super, ni DOM. */

export type Product = { sku: string; label: string; price: number };

export type CartLine = { product: Product; quantity: number; subtotal: number };

export type Order = { orderId: string; total: number };

/** Catalogue de la boutique (prix en centimes). */
export const PRODUCTS: readonly Product[] = [
  { sku: 'mug', label: 'Mug Super', price: 1200 },
  { sku: 'tshirt', label: 'T-shirt Super', price: 2500 },
  { sku: 'sticker', label: 'Lot de stickers', price: 400 },
];

/** Les lignes du panier, dans l'ordre du catalogue, sans les produits absents. */
export const linesOf = (quantities: Readonly<Record<string, number>>): CartLine[] =>
  PRODUCTS.filter((p) => (quantities[p.sku] ?? 0) > 0).map((product) => {
    const quantity = quantities[product.sku]!;
    return { product, quantity, subtotal: quantity * product.price };
  });
