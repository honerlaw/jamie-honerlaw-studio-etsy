// The other half of the cycle with cycle-a.
import { one } from "./cycle-a";

/** Returns a value that refers back to cycle-a. */
export function two(): number {
  return typeof one === "function" ? 2 : 0;
}
