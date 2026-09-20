// functions/api/_shared/fulfill-wattwise.js
// Fulfillment hook for the WattWise products (wattwise-audit, wattwise-monthly).
//
// Deliberately a no-op: both products are delivered ON-DEMAND by the
// wattwise.mehyar.us worker, which gates on the paid billing_payments row
// (token = access_token) via its BILLING_DB binding. The $14.99 audit is
// generated when the buyer clicks "Generate my audit"; the $7.99/mo
// monitoring dashboard gates on the active subscription row.
//
// This hook exists so the products' `fulfillment` column stays meaningful,
// delivery stays idempotent (row already marked paid before this runs),
// and — per standing policy — NO external email is ever sent from here.

export async function fulfillWattwise() {
  // Nothing to do: delivery is pull-based on the product worker.
  return;
}
