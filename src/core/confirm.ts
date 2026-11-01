/** Lo que `confirmHuman` necesita de la entrada/salida de la CLI (ver `CliIo` en cli-run.ts). */
export interface ConfirmIo {
  err: (s: string) => void;
  /** ¿Es `stream` un terminal real? Si falta, se trata como que no lo es (falla cerrado). */
  isTty?: (stream: "stdin" | "stderr") => boolean;
  /** Lee UNA línea sin el salto de línea; `null` en EOF. */
  readLine?: () => Promise<string | null>;
}

export type ConfirmResult = "confirmed" | "no_tty" | "mismatch" | "eof";

/**
 * Confirmación humana para operaciones que cambian algo.
 *
 * - Exige que stdin sea un TTY real; si no, devuelve `no_tty` sin leer nada, de modo que una tubería
 *   (`echo frase | shardev ...`) nunca confirma. También exige stderr como TTY: ahí van el resumen y el
 *   prompt, y si nadie los ve no hay confirmación informada.
 * - Una sola lectura, sin reintentos. La frase debe coincidir exacta (mayúsculas incluidas); solo se
 *   quita el fin de línea (`\n` o `\r\n`). EOF/Ctrl-D devuelve `eof`.
 * - No hay `--yes`, `--force` ni variable de entorno (tampoco `CI`) que lo eluda.
 * - Resumen y prompt van a stderr para que la salida `--json` por stdout siga siendo solo el JSON.
 * - Secretos: `summary` NO se redacta aquí; el llamador debe pasar líneas ya redactadas.
 *
 * Límite: la comprobación de TTY frena tuberías y agentes no interactivos, pero un proceso que
 * reserve un pty (`script`, `expect`) puede simularlo. No es una frontera de seguridad frente a un
 * proceso local hostil; ver docs/decisions/0010-operaciones-t3.md.
 */
export async function confirmHuman(io: ConfirmIo, opts: { summary: string[]; phrase: string }): Promise<ConfirmResult> {
  if (!io.isTty?.("stdin") || !io.isTty("stderr") || !io.readLine) return "no_tty";
  io.err(`${opts.summary.join("\n")}\nPara confirmar escribe exactamente: ${opts.phrase}\n> `);
  const line = await io.readLine();
  if (line === null) {
    io.err("\n");
    return "eof";
  }
  return line.replace(/\r?\n$/, "") === opts.phrase ? "confirmed" : "mismatch";
}
