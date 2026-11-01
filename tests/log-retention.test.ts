import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { runOps, type CliIo } from "../src/cli-run.js";
import { logsDir } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { logRead } from "../src/ops/log-read.js";
import { isExpiredOpsLog, OPS_LOGS_RETENTION_MS } from "../src/ops/log-retention.js";
import { serve } from "../src/server.js";
import { OPS_YAML_SERVICES, cleanup, fakeRunner, registerDemoProject, tempDir, tempPaths } from "./helpers/fixtures.js";

afterEach(cleanup);

const NOW = new Date("2026-11-01T12:00:00.000Z");
const OLD = "20261020T120000-aaaaaaaa-ops-logs-demo-app.log";
const RECENT = "20261030T120000-bbbbbbbb-ops-logs-demo-app.log";
const OTHER_OLD = "20200101T000000-cccccccc-project-create.log";
const BAD_NAME = "20200101T000000-notes-ops-logs-x.log";

function io(): { io: CliIo; out: string[] } {
  const out: string[] = [];
  return { out, io: { out: (s) => out.push(s), err: () => undefined, stdin: async () => "" } };
}

async function fixture() {
  const paths = await tempPaths();
  await registerDemoProject(paths, "", OPS_YAML_SERVICES());
  const dir = logsDir(paths);
  await mkdir(dir, { recursive: true });
  const outside = join(await tempDir(), "target.txt");
  await writeFile(outside, "no me borres");
  for (const n of [OLD, RECENT, OTHER_OLD, BAD_NAME]) await writeFile(join(dir, n), "linea\n");
  const link = "20200101T000000-dddddddd-ops-logs-link.log";
  await symlink(outside, join(dir, link));
  const ctx = createContext(paths, { runner: fakeRunner({ "demo-stg": "111111111111" }), now: () => NOW });
  return { paths, dir, ctx, link };
}

const survivors = [RECENT, OTHER_OLD, BAD_NAME, "20200101T000000-dddddddd-ops-logs-link.log"];

describe("purga de ops_logs sin nueva llamada a ops_logs (ADJ-06)", () => {
  test("cualquier `shardev ops` purga solo las copias vencidas exactas", async () => {
    const { ctx, dir } = await fixture();
    expect(await runOps(["status", "--project", "demo"], io().io, ctx)).toBe(0);
    const left = await readdir(dir);
    expect(left).not.toContain(OLD);
    expect(left).toEqual(expect.arrayContaining(survivors));
  });

  test("log_read y `ops log-read` purgan, y una copia vencida da el rechazo normal de no encontrada", async () => {
    const a = await fixture();
    const r = await logRead(a.ctx, { ref: OLD });
    expect(r).toMatchObject({ isError: true, decision: "rejected" });
    expect(r.text).toBe(`No existe el log ${OLD}.`);
    expect(await readdir(a.dir)).not.toContain(OLD);
    expect(await readdir(a.dir)).toEqual(expect.arrayContaining(survivors));
    expect((await logRead(a.ctx, { ref: RECENT })).isError).toBe(false);

    const b = await fixture();
    const o = io();
    expect(await runOps(["log-read", "--ref", OLD], o.io, b.ctx)).toBe(1);
    expect(o.out.join("")).toContain("No existe el log");
    expect(await readdir(b.dir)).not.toContain(OLD);
  });

  test("si la purga falla, el comando no falla y log_read igual rechaza la copia vencida", async () => {
    const { ctx, dir } = await fixture();
    ctx.logs.purgeOlderThan = async () => {
      throw new Error("EACCES");
    };
    const o = io();
    expect(await runOps(["status", "--project", "demo"], o.io, ctx)).toBe(0);
    expect(await readdir(dir)).toContain(OLD); // sigue en disco: la purga falló
    const r = await logRead(ctx, { ref: OLD });
    expect(r).toMatchObject({ isError: true, decision: "rejected", text: `No existe el log ${OLD}.` });
    expect((await logRead(ctx, { ref: RECENT })).isError).toBe(false);
    // otros logs viejos que no son de ops_logs siguen legibles
    expect((await logRead(ctx, { ref: OTHER_OLD })).isError).toBe(false);
  });

  test("isExpiredOpsLog: solo nombres de ops_logs, con borde exacto", () => {
    const edge = new Date(Date.UTC(2026, 10, 1, 12, 0, 0) - OPS_LOGS_RETENTION_MS);
    expect(isExpiredOpsLog("20261025T120000-aaaaaaaa-ops-logs-x.log", NOW)).toBe(false); // justo en el límite
    expect(isExpiredOpsLog("20261025T115959-aaaaaaaa-ops-logs-x.log", NOW)).toBe(true);
    expect(edge.toISOString()).toBe("2026-10-25T12:00:00.000Z");
    expect(isExpiredOpsLog(OTHER_OLD, NOW)).toBe(false);
    expect(isExpiredOpsLog(BAD_NAME, NOW)).toBe(false);
    expect(isExpiredOpsLog("../" + OLD, NOW)).toBe(false);
  });

  test("el arranque del servidor purga", async () => {
    const { paths, dir } = await fixture();
    const ancient = "20200101T000000-eeeeeeee-ops-logs-ancient.log"; // vencido con el reloj real
    await writeFile(join(dir, ancient), "x");
    const fresh = `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}-ffffffff-ops-logs-fresh.log`;
    await writeFile(join(dir, fresh), "x");
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([serve({ paths, transport: a }), client.connect(b)]);
    const left = await readdir(dir);
    expect(left).not.toContain(ancient);
    expect(left).toEqual(expect.arrayContaining([fresh, OTHER_OLD, BAD_NAME]));
    await client.close();
  });
});
