export interface LineItem {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export function calculateSubtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
}

export function calculateTax(subtotal: number, taxRate: number): number {
  return subtotal * taxRate;
}

export function applyDiscount(subtotal: number, discountRate: number): number {
  return subtotal * (1 - discountRate);
}

export function calculateTotal(items: LineItem[], taxRate: number, discountRate: number): number {
  const subtotal = calculateSubtotal(items);
  const discounted = applyDiscount(subtotal, discountRate);
  const tax = calculateTax(discounted, taxRate);
  return discounted + tax;
}
