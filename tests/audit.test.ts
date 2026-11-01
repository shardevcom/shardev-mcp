import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { AuditLog } from "../src/core/audit.js";
import { Redactor } from "../src/core/redact.js";
import { cleanup, tempDir } from "./helpers/fixtures.js";

afterEach(cleanup);

test("auditoría JSONL append-only con argumentos redactados y permisos privados", async () => {
  const file = join(await tempDir(), "state", "audit.jsonl");
  const red = new Redactor();
  red.register("valor-literal-secreto");
  const a = new AuditLog(file, red, () => new Date("2026-01-02T03:04:05Z"));
  await a.record({ tool: "t1", project: "demo", env: "prod", tier: "T3", decision: "command-only", exit_code: null, duration_ms: 7, args: { api_key: "zzz", cmd: 'export X_TOKEN="a b"', n: "valor-literal-secreto" } });
  await a.record({ tool: "t2", tier: "T0", decision: "allowed", duration_ms: 1 });
  const lines = (await readFile(file, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatchObject({ time: "2026-01-02T03:04:05.000Z", tool: "t1", project: "demo", env: "prod", tier: "T3", decision: "command-only", duration_ms: 7 });
  const raw = JSON.stringify(lines[0]);
  expect(raw).not.toMatch(/zzz|a b|valor-literal-secreto/);
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(dirname(file))).mode & 0o777).toBe(0o700);
});
