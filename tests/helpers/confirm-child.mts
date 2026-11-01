// @ts-nocheck -- se ejecuta con node --experimental-strip-types (imports .ts); no entra en el typecheck.
import { confirmHuman } from "../../src/core/confirm.ts";
import { isRealTty, readOneLine } from "../../src/core/tty-io.ts";

const r = await confirmHuman(
  { err: (s) => process.stderr.write(s), isTty: isRealTty, readLine: readOneLine },
  { summary: ["resumen"], phrase: "demo/prod" },
);
process.stdout.write(`${r}\n`);
