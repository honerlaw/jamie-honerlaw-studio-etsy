// Re-exports two functions defined elsewhere. tests/lint-gate.test.ts pins how
// agentic/one-export-per-file treats this shape.
export { first } from "./first";
export { second } from "./second";
