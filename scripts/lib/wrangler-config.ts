import ts from "typescript";

// wrangler.jsonc is JSON with comments; TypeScript's parser reads it exactly as
// wrangler does, so no extra dependency is needed.

export interface WranglerConfig {
  /** The whole parsed config, for writing the generated deploy config. */
  readonly raw: Readonly<Record<string, unknown>>;
  /** `secrets.required`: every Worker secret a deploy must supply. */
  readonly requiredSecrets: readonly string[];
  /** The `kv_namespaces` binding names, in order. */
  readonly kvBindings: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string")) {
    throw new Error(`wrangler config: ${what} must be a list of strings`);
  }
  return value;
}

export function parseWranglerConfig(text: string): WranglerConfig {
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", text);
  if (parsed.error !== undefined || !isRecord(parsed.config)) {
    throw new Error("wrangler config: not a valid JSONC object");
  }
  const raw = parsed.config;
  const secrets = raw["secrets"];
  const requiredSecrets = stringList(isRecord(secrets) ? secrets["required"] : undefined, "secrets.required");
  const namespaces = raw["kv_namespaces"];
  if (!Array.isArray(namespaces)) {
    throw new TypeError("wrangler config: kv_namespaces must be a list");
  }
  const kvBindings = stringList(
    namespaces.map((entry: unknown) => (isRecord(entry) ? entry["binding"] : undefined)),
    "kv_namespaces[].binding",
  );
  return { raw, requiredSecrets, kvBindings };
}
