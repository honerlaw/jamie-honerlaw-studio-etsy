// Deliberately violates the gate. tests/lint-gate.test.ts asserts each rule fires.

export function parse(input: any): unknown {
  return input;
}

async function save(): Promise<void> {
  await Promise.resolve();
}

export function run(): void {
  save();
}

// eslint-disable-next-line no-console
console.log("x");

export const remote = "https://user:secret@api.etsy.com/v3";
