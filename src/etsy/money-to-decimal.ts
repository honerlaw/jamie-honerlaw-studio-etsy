// Etsy money as it arrives from the API.
export interface EtsyMoney {
  readonly amount: number;
  readonly divisor: number;
  readonly currency_code: string;
}

// Etsy returns prices as `{amount, divisor}` (1999 / 100) but takes a plain decimal
// (19.99) on writes. Rounded to the divisor's precision, so 1999/100 is exactly 19.99.
export function moneyToDecimal(money: Pick<EtsyMoney, "amount" | "divisor">): number {
  const places = Math.round(Math.log10(money.divisor));
  return Number((money.amount / money.divisor).toFixed(Math.max(places, 0)));
}
