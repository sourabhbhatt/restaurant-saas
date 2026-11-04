import { DomainError } from "../shared/errors";
import { applyBps, assertMinorUnits, MAX_BPS, sum } from "../shared/money";

/**
 * Bill arithmetic. Pure and deterministic: the same snapshot input always
 * produces the same bill. All amounts in minor units, all rates in bps.
 *
 * Order of operations:
 *   subtotal (sum of order-time line totals)
 *   − discount (percentage or flat, capped at subtotal)
 *   = net goods (tax extracted first when menu prices include tax)
 *   + service charge (bps of net goods)
 *   = taxable base
 *   + taxes (each rate applied to the taxable base)
 *   = grand total
 */

export interface TaxRate {
  name: string;
  rateBps: number;
}

export const DISCOUNT_TYPES = ["PERCENT", "FLAT"] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface BillDiscount {
  type: DiscountType;
  /** bps for PERCENT, minor units for FLAT */
  value: number;
  reason?: string | null;
}

export interface BillLineInput {
  lineTotal: number;
}

export interface BillTaxConfig {
  taxes: readonly TaxRate[];
  pricesIncludeTax: boolean;
  serviceChargeBps: number;
}

export interface TaxLine {
  name: string;
  rateBps: number;
  amount: number;
}

export interface BillTotals {
  subtotal: number;
  discountAmount: number;
  netGoods: number;
  serviceChargeAmount: number;
  taxableBase: number;
  taxes: TaxLine[];
  taxTotal: number;
  grandTotal: number;
}

export function validateTaxConfig(config: BillTaxConfig): void {
  const total = sum(config.taxes.map((t) => t.rateBps));
  if (config.taxes.some((t) => !Number.isInteger(t.rateBps) || t.rateBps < 0)) {
    throw new DomainError("VALIDATION_FAILED", "Tax rates must be non-negative");
  }
  if (total > MAX_BPS) throw new DomainError("VALIDATION_FAILED", "Total tax cannot exceed 100%");
  if (
    !Number.isInteger(config.serviceChargeBps) ||
    config.serviceChargeBps < 0 ||
    config.serviceChargeBps > 5000
  ) {
    throw new DomainError("VALIDATION_FAILED", "Service charge must be between 0% and 50%");
  }
}

export function computeDiscount(
  subtotal: number,
  discount: BillDiscount | null | undefined,
): number {
  if (!discount || discount.value === 0) return 0;
  if (!Number.isInteger(discount.value) || discount.value < 0) {
    throw new DomainError("VALIDATION_FAILED", "Discount must be a positive amount", {
      fieldErrors: { discountValue: ["Discount must be a positive amount"] },
    });
  }
  if (discount.type === "PERCENT") {
    if (discount.value > MAX_BPS) {
      throw new DomainError("VALIDATION_FAILED", "Discount cannot exceed 100%", {
        fieldErrors: { discountValue: ["Discount cannot exceed 100%"] },
      });
    }
    return applyBps(subtotal, discount.value);
  }
  return Math.min(discount.value, subtotal);
}

/** Split `total` across rates proportionally; rounding remainder goes to the largest rate. */
function allocate(total: number, taxes: readonly TaxRate[]): number[] {
  const rateSum = sum(taxes.map((t) => t.rateBps));
  if (rateSum === 0 || total === 0) return taxes.map(() => 0);
  const shares = taxes.map((t) => Math.floor((total * t.rateBps) / rateSum));
  let remainder = total - sum(shares);
  const order = taxes.map((t, i) => [t.rateBps, i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    const idx = order[k]![1];
    shares[idx] = shares[idx]! + 1;
  }
  return shares;
}

export function calculateBill(
  lines: readonly BillLineInput[],
  config: BillTaxConfig,
  discount?: BillDiscount | null,
): BillTotals {
  validateTaxConfig(config);
  lines.forEach((l) => assertMinorUnits(l.lineTotal, "lineTotal"));

  const subtotal = sum(lines.map((l) => l.lineTotal));
  const discountAmount = computeDiscount(subtotal, discount);
  const afterDiscount = subtotal - discountAmount;
  const rateSum = sum(config.taxes.map((t) => t.rateBps));

  if (!config.pricesIncludeTax) {
    const netGoods = afterDiscount;
    const serviceChargeAmount = applyBps(netGoods, config.serviceChargeBps);
    const taxableBase = netGoods + serviceChargeAmount;
    const taxes = config.taxes.map((t) => ({
      name: t.name,
      rateBps: t.rateBps,
      amount: applyBps(taxableBase, t.rateBps),
    }));
    const taxTotal = sum(taxes.map((t) => t.amount));
    return {
      subtotal,
      discountAmount,
      netGoods,
      serviceChargeAmount,
      taxableBase,
      taxes,
      taxTotal,
      grandTotal: taxableBase + taxTotal,
    };
  }

  // Prices include tax: extract the tax already inside the goods amount.
  const netGoods = Math.round((afterDiscount * MAX_BPS) / (MAX_BPS + rateSum));
  const goodsTax = allocate(afterDiscount - netGoods, config.taxes);
  const serviceChargeAmount = applyBps(netGoods, config.serviceChargeBps);
  const scTax = config.taxes.map((t) => applyBps(serviceChargeAmount, t.rateBps));
  const taxes = config.taxes.map((t, i) => ({
    name: t.name,
    rateBps: t.rateBps,
    amount: goodsTax[i]! + scTax[i]!,
  }));
  const taxTotal = sum(taxes.map((t) => t.amount));
  const taxableBase = netGoods + serviceChargeAmount;
  return {
    subtotal,
    discountAmount,
    netGoods,
    serviceChargeAmount,
    taxableBase,
    taxes,
    taxTotal,
    grandTotal: taxableBase + taxTotal,
  };
}
