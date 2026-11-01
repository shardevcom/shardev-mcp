import { createInterface } from "node:readline";

/** ¿Es el flujo del proceso un terminal real? */
export const isRealTty = (stream: "stdin" | "stderr"): boolean => (stream === "stdin" ? process.stdin.isTTY === true : process.stderr.isTTY === true);

/** Lee exactamente una línea de stdin (terminal) y suelta stdin para que el proceso pueda terminar. */
export function readOneLine(): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      rl.close();
      process.stdin.pause();
      resolve(v);
    };
    rl.once("line", (l) => finish(l));
    rl.once("close", () => finish(null));
  });
}
