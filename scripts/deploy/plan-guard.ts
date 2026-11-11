interface ResourceChange {
  readonly address?: unknown;
  readonly change?: { readonly actions?: unknown };
}

/**
 * Addresses of every resource the plan would delete, including replacements
 * (delete + create). `prevent_destroy` only guards a block that still exists;
 * this catches a merged change that deletes or renames one.
 */
export function plannedDeletions(planJson: string): string[] {
  const plan = JSON.parse(planJson) as { readonly resource_changes?: readonly ResourceChange[] };
  const deletions: string[] = [];
  for (const change of plan.resource_changes ?? []) {
    const actions = change.change?.actions;
    if (Array.isArray(actions) && actions.includes("delete")) {
      deletions.push(typeof change.address === "string" ? change.address : "(unnamed resource)");
    }
  }
  return deletions;
}
