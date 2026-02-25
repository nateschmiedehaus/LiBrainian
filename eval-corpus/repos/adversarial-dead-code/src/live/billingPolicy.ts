export interface Invoice {
  id: string;
  daysOverdue: number;
}

export function enforceActiveBillingPolicy(invoice: Invoice): 'pay-now' | 'allow-grace-period' {
  return invoice.daysOverdue >= 30 ? 'pay-now' : 'allow-grace-period';
}

export const ACTIVE_BILLING_POLICY = 'active-billing-policy-enforcement';
