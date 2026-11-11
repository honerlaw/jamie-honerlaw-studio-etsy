// GitHub Actions hides a value in every later log line once it sees
// `::add-mask::<value>`. Short values and the "unset" placeholder are skipped:
// masking them would only blank out ordinary words in the log.

const MIN_LENGTH = 8;

function jsonLeaves(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      jsonLeaves(item, into);
    }
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) {
      jsonLeaves(item, into);
    }
  }
}

function parsedLeaves(value: string): string[] {
  const leaves: string[] = [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object") {
      jsonLeaves(parsed, leaves);
    }
  } catch {
    // Not JSON: the value's own lines are what gets masked.
  }
  return leaves;
}

/** The pieces of one secret value to mask: each line, plus every string inside a JSON value. */
export function maskablePieces(value: string): string[] {
  const pieces = [...value.split(/\r?\n/u), ...parsedLeaves(value)];
  return [...new Set(pieces)].filter((piece) => piece.length >= MIN_LENGTH && piece !== "unset");
}

/** `::add-mask::` commands for each piece, with `%`, CR and LF escaped as the runner expects. */
export function maskCommands(values: readonly string[]): string[] {
  const pieces = new Set(values.flatMap((value) => maskablePieces(value)));
  return [...pieces].map(
    (piece) => `::add-mask::${piece.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`,
  );
}
