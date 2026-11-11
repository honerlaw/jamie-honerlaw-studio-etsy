// Imports cycle-b, which imports this file back. import-x/no-cycle must report it.
import { two } from "./cycle-b";

/** Returns one more than cycle-b's value. */
export function one(): number {
  return two() + 1;
}
