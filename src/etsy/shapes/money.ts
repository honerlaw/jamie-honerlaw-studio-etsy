import { z } from "zod";

import { moneyToDecimal } from "../money-to-decimal";

// Etsy's `{amount, divisor, currency_code}`, shown to the model as a decimal amount.
export const MONEY = z
  .object({ amount: z.number(), divisor: z.number().positive(), currency_code: z.string() })
  .transform((money) => ({ amount: moneyToDecimal(money), currency_code: money.currency_code }));
