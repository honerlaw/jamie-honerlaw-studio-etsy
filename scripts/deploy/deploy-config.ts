/**
 * wrangler.jsonc with each KV binding's `id` filled in from Terraform's
 * `kv_namespace_ids` output. Written as wrangler.deploy.json at the repo root, so
 * the config's relative paths (`main`, `$schema`) still resolve.
 */
export function withKvIds(
  raw: Readonly<Record<string, unknown>>,
  ids: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const namespaces = raw["kv_namespaces"] as readonly { readonly binding: string }[];
  const filled = namespaces.map((namespace) => {
    const id = ids[namespace.binding];
    if (id === undefined) {
      throw new Error(`Terraform output has no KV namespace id for binding ${namespace.binding}.`);
    }
    return { ...namespace, id };
  });
  return { ...raw, kv_namespaces: filled };
}
