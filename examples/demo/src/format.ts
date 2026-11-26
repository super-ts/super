/** User-land: format a price in cents, 1200 gives "€12.00". A display concern, not a store one. */
export const formatPrice = (cents: number) => `€${(cents / 100).toFixed(2)}`;
