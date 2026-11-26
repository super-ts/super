/** User-land : formater un prix en centimes, 1200 donne « 12,00 € ». Une affaire d'affichage, pas de store. */
export const formatPrice = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;
