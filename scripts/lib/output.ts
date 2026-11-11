// The one place repo scripts write to the terminal. Written through process
// streams (not console) so the scripts need no `no-console` carve-out.

export interface Output {
  readonly line: (text: string) => void;
  readonly error: (text: string) => void;
}

export function processOutput(): Output {
  return {
    line: (text) => process.stdout.write(`${text}\n`),
    error: (text) => process.stderr.write(`${text}\n`),
  };
}
