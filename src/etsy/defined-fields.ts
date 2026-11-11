// `T` with members that may be undefined turned into optional members without
// `undefined`, which is what the generated request types expect.
export type Defined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

// Drops undefined members so they aren't sent as the string "undefined" in Etsy's
// form-encoded bodies or query strings. Arrays stay arrays; openapi-fetch joins them
// with commas in a form body.
export function definedFields<T extends Record<string, unknown>>(fields: T): Defined<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Defined<T>;
}
