// Asks the owner for values. A secret prompt switches the terminal to raw mode so
// what she types is never echoed; a visible prompt leaves the terminal's own echo on.

export interface Prompter {
  readonly secret: (label: string) => Promise<string>;
  readonly visible: (label: string) => Promise<string>;
}

export interface PromptInput extends NodeJS.EventEmitter {
  readonly isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
  resume: () => unknown;
  pause: () => unknown;
}

export interface PromptOutput {
  write: (text: string) => unknown;
}

const CTRL_C = "\u0003";
const BACKSPACE = new Set(["\u007f", "\b"]);

function readLine(input: PromptInput, hidden: boolean): Promise<string> {
  const raw = hidden && input.isTTY === true && input.setRawMode !== undefined;
  return new Promise((resolve, reject) => {
    let typed = "";
    const finish = (settle: () => void): void => {
      input.off("data", onData);
      if (raw) {
        input.setRawMode?.(false);
      }
      input.pause();
      settle();
    };
    function onData(chunk: Buffer | string): void {
      for (const char of chunk.toString()) {
        if (char === "\r" || char === "\n") {
          finish(() => {
            resolve(typed);
          });
          return;
        }
        if (char === CTRL_C) {
          finish(() => {
            reject(new Error("Cancelled."));
          });
          return;
        }
        typed = BACKSPACE.has(char) ? typed.slice(0, -1) : typed + char;
      }
    }
    if (raw) {
      input.setRawMode?.(true);
    }
    input.on("data", onData);
    input.resume();
  });
}

export function terminalPrompter(input: PromptInput, output: PromptOutput): Prompter {
  return {
    secret: async (label) => {
      output.write(`${label} (hidden): `);
      const value = await readLine(input, true);
      output.write("\n");
      return value.trim();
    },
    visible: async (label) => {
      output.write(`${label}: `);
      return (await readLine(input, false)).trim();
    },
  };
}
