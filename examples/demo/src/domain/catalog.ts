/** Un produit du catalogue de démonstration. */
export type Product = { id: number; title: string; brand: string | null; price: number; rating: number };

/** Les colonnes sur lesquelles le catalogue sait trier. */
export const PRODUCT_SORTS = ['title', 'brand', 'price', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

export const isProductSort = (key: string): key is ProductSort => (PRODUCT_SORTS as readonly string[]).includes(key);

/** Une page demandée : numéro (à partir de 1), taille, tri. */
export type ProductQuery = { page: number; pageSize: number; sort: ProductSort | null; order: SortOrder };
/** Une page reçue, et le nombre total de produits. */
export type ProductPage = { products: Product[]; total: number };
