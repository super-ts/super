/** A product from the demo catalogue. */
export type Product = { id: number; title: string; brand: string | null; price: number; rating: number };

/** The columns the catalogue can sort on. */
export const PRODUCT_SORTS = ['title', 'brand', 'price', 'rating'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

export const isProductSort = (key: string): key is ProductSort => (PRODUCT_SORTS as readonly string[]).includes(key);

/** A requested page: number (starting at 1), size, sort. */
export type ProductQuery = { page: number; pageSize: number; sort: ProductSort | null; order: SortOrder };
/** A received page, and the total number of products. */
export type ProductPage = { products: Product[]; total: number };
