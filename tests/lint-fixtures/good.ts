// Satisfies the full strict rule set: tests/lint-gate.test.ts asserts zero messages.

/** Adds two integers. */
export function add(left: number, right: number): number {
  return left + right;
}
