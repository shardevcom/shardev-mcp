import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { runApp, runOps, runProject, type CliIo } from "../src/cli-run.js";
import { auditFile } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { awsRunner, cwLogs } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempPaths } from "./helpers/fixtures.js";
import { SPEC, setup } from "./helpers/gen-fixtures.js";

const NOW = new Date("2026-11-01T12:00:00.000Z");

function io(stdin = ""): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s), stdin: async () => stdin } };
}

async function entries(file: string): Promise<Array<Record<string, unknown>>> {
  try {
    return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

async function opsSetup() {
  const paths = await tempPaths();
  await registerDemoProject(paths, "", OPS_YAML_SERVICES());
  const runner = awsRunner({ "demo-stg": "111111111111" }, {
    "ecs describe-services": () => ({ services: [{ serviceName: "demo-staging-app", status: "ACTIVE", desiredCount: 1, runningCount: 1, pendingCount: 0, taskDefinition: "arn:x:task-definition/demo-staging-app:7" }], failures: [] }),
    "logs filter-log-events": cwLogs([{ timestamp: Date.parse("2026-11-01T11:45:00Z"), message: "hola" }]),
  });
  return { paths, ctx: createContext(paths, { runner, now: () => NOW }) };
}

describe("auditoría de la CLI (ADJ-09)", () => {
  afterEach(cleanup);

  test("una lectura escribe una entrada source cli con tool, tier, decisión y exit code", async () => {
    const { paths, ctx } = await opsSetup();
    expect(await runOps(["services", "--project", "demo", "--env", "staging", "--json"], io().io, ctx)).toBe(0);
    const [e, ...rest] = await entries(auditFile(paths));
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({ source: "cli", tool: "ops_services", project: "demo", env: "staging", tier: "T1", decision: "allowed", exit_code: 0, args: { project: "demo", env: "staging" } });
    expect(typeof e!.duration_ms).toBe("number");
    expect(typeof e!.time).toBe("string");
  });

  test("una operación que falla registra el fallo y sale con 1", async () => {
    const { paths, ctx } = await opsSetup();
    expect(await runOps(["services", "--project", "demo", "--env", "staging", "--service", "otro"], io().io, ctx)).toBe(1);
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ source: "cli", tool: "ops_services", decision: "rejected", exit_code: 1 });
    expect(await runOps(["services", "--project", "demo", "--env", "prod"], io().io, ctx)).toBe(1);
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ source: "cli", tool: "ops_services", env: "prod", decision: "disabled", exit_code: 1 });
  });

  test("entrada inválida: se registra rejected y el error se propaga igual; subcomando desconocido no registra", async () => {
    const { paths, ctx } = await opsSetup();
    await expect(runOps(["services", "--project", "demo"], io().io, ctx)).rejects.toThrow(/Falta --env/);
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ source: "cli", tool: "ops_services", project: "demo", tier: "T1", decision: "rejected", exit_code: 2 });
    await expect(runOps(["logs", "--project", "demo", "--env", "staging", "--service", "s", "--limit", "abc"], io().io, ctx)).rejects.toThrow(/número entero/);
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ tool: "ops_logs", decision: "rejected", exit_code: 2 });
    await expect(runOps(["log-read"], io().io, ctx)).rejects.toThrow(/Falta --ref/);
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ tool: "log_read", tier: "T0", decision: "rejected" });

    const before = (await entries(auditFile(paths))).length;
    // la rama `bad` de log-read: sale con 1 e imprime el mismo texto
    const o = io();
    expect(await runOps(["log-read", "--ref", "x", "--limit", "9999"], o.io, ctx)).toBe(1);
    expect(o.out.join("")).toBe("--limit debe estar entre 1 y 500\n");
    expect((await entries(auditFile(paths))).at(-1)).toMatchObject({ source: "cli", tool: "log_read", decision: "rejected", exit_code: 1, args: { ref: "x", limit: 9999 } });
    expect(await entries(auditFile(paths))).toHaveLength(before + 1);

    await expect(runOps(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    await expect(runProject(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    await expect(runApp(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    expect(await entries(auditFile(paths))).toHaveLength(before + 1);
  });

  test("los argumentos con apariencia de secreto se redactan", async () => {
    const { paths, ctx } = await opsSetup();
    await runOps(["logs", "--project", "demo", "--env", "staging", "--service", "demo-staging-app", "--filter", "API_TOKEN=zzz-secreto-distintivo"], io().io, ctx);
    const raw = await readFile(auditFile(paths), "utf8");
    expect(raw).not.toContain("zzz-secreto-distintivo");
    const e = (await entries(auditFile(paths))).at(-1)!;
    expect(e).toMatchObject({ tool: "ops_logs", tier: "T1", decision: "allowed" });
    expect((e.args as { filter: string }).filter).toContain("[REDACTED]");
  });

  test("project y app: mismo nombre y tier T2 que las herramientas MCP", async () => {
    const { ctx, root, paths } = await setup();
    const target = `${root}/acme`;
    const a = io(JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", "-", "--target", target, "--json"], a.io, ctx)).toBe(0);
    const planId = JSON.parse(a.out.join("")).plan_id as string;
    expect(await runProject(["create", "--plan-id", planId, "--json"], io().io, ctx)).toBe(0);
    expect(await runApp(["create", "--plan-id", "plan_inexistente"], io().io, ctx)).toBe(1);
    const e = await entries(auditFile(paths));
    expect(e.map((x) => [x.source, x.tool, x.tier])).toEqual([["cli", "project_plan", "T2"], ["cli", "project_create", "T2"], ["cli", "app_create", "T2"]]);
    expect(e[0]!.args).toMatchObject({ target }); // el spec se registra como lo haría el servidor (recortado y redactado)
    expect(e[2]).toMatchObject({ decision: expect.any(String), exit_code: 1 });
  });

  test("si la auditoría falla, stdout y exit code no cambian y se avisa por stderr", async () => {
    const { ctx } = await opsSetup();
    const ok = io();
    const code = await runOps(["services", "--project", "demo", "--env", "staging", "--json"], ok.io, ctx);
    ctx.audit.record = async () => {
      throw new Error("disco lleno");
    };
    const bad = io();
    expect(await runOps(["services", "--project", "demo", "--env", "staging", "--json"], bad.io, ctx)).toBe(code);
    expect(bad.out.join("")).toBe(ok.out.join(""));
    expect(() => JSON.parse(bad.out.join(""))).not.toThrow();
    expect(bad.err.join("")).toMatch(/no se pudo escribir la auditoría: disco lleno/);
    expect(ok.err).toHaveLength(0);

    const rej = io();
    await expect(runOps(["services", "--project", "demo"], rej.io, ctx)).rejects.toThrow(/Falta --env/);
    expect(rej.err.join("")).toMatch(/no se pudo escribir la auditoría/);
    expect(rej.out).toHaveLength(0);
  });

  test("--json imprime exactamente el JSON de la herramienta", async () => {
    const { ctx } = await opsSetup();
    const a = io();
    await runOps(["services", "--project", "demo", "--env", "staging", "--json"], a.io, ctx);
    expect(a.out).toHaveLength(1);
    expect(a.out[0]!.endsWith("\n")).toBe(true);
    expect(JSON.parse(a.out[0]!).services[0]).toMatchObject({ service: "demo-staging-app" });
    expect(a.err).toHaveLength(0);
  });
});
