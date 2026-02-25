export type LineItem = { unitPriceCents: number; quantity: number };

export function calculateOrderTotalPriceEngineCanonical(items: LineItem[]): number {
  const subtotal = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const discount = subtotal > 10_000 ? Math.floor(subtotal * 0.1) : 0;
  return subtotal - discount;
}

export const PRICE_ENGINE_CANONICAL = 'price-engine-canonical-discount-math';
