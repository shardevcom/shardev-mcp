#!/usr/bin/env node
import { CLI_VERSION, USAGE, runApp, runOps, runProject } from "./cli-run.js";
import { ShardevError } from "./core/errors.js";
import { isRealTty, readOneLine } from "./core/tty-io.js";
import { serve } from "./server.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
  const [group, sub, ...rest] = argv;
  if (group === "mcp" && sub === "serve") {
    await serve();
    return -1; // el transporte mantiene vivo el proceso
  }
  if (group === "project" || group === "app" || group === "ops") {
    try {
      return await (group === "app" ? runApp : group === "ops" ? runOps : runProject)([sub ?? "", ...rest], {
        out: (s) => process.stdout.write(s),
        err: (s) => process.stderr.write(s),
        stdin: readStdin,
        isTty: isRealTty,
        readLine: readOneLine,
      });
    } catch (e) {
      if (e instanceof ShardevError) {
        process.stderr.write(`${e.message}\n`);
        return e.code === "invalid_input" ? 2 : 1;
      }
      throw e;
    }
  }
  if (group === "--version" || group === "-v") {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }
  if (group === "--help" || group === "-h" || group === undefined) {
    process.stderr.write(USAGE);
    return group === undefined ? 2 : 0;
  }
  process.stderr.write(`Comando desconocido: ${group}\n${USAGE}`);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`Error fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
