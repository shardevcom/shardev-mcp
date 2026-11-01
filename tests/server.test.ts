import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { exec, type Runner } from "../src/core/exec.js";
import { createServer } from "../src/server.js";
import { annotationsForTier, effectiveTier, listOperations, metaForTier } from "../src/ops/catalog.js";
import { auditFile } from "../src/core/paths.js";
import { awsRunner } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, fakeRunner, registerDemoProject, tempDir, tempPaths, write } from "./helpers/fixtures.js";
import { SPEC, writeTemplates } from "./helpers/gen-fixtures.js";

afterEach(cleanup);

async function connect(accounts: Record<string, string | "expired"> = {}, extra: { templatesDir?: string; runner?: Runner; paths?: Awaited<ReturnType<typeof tempPaths>> } = {}) {
  const paths = extra.paths ?? (await tempPaths());
  const fake = fakeRunner(accounts);
  const runner = extra.runner ?? fake;
  const { server, ctx } = createServer({ paths, runner, ...(extra.templatesDir ? { templatesDir: extra.templatesDir } : {}) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content[0]?.text ?? "", isError: r.isError === true };
  };
  return { paths, runner: fake, ctx, client, call };
}

describe("servidor MCP", () => {
  test("expone ops_status/log_read (solo lectura) y project_* (T2: no solo lectura, no destructivas, sin AWS)", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["app_create", "app_plan", "log_read", "ops_ci_check", "ops_ci_generate", "ops_env_check", "ops_logs", "ops_redeploy", "ops_scale", "ops_services", "ops_status", "ops_tasks", "project_create", "project_plan", "project_verify"]);
    for (const n of ["ops_redeploy", "ops_scale"]) expect(tools.find((t) => t.name === n)!.annotations).toMatchObject({ destructiveHint: true }); // T3, ver redeploy.test.ts y scale.test.ts
    for (const t of tools.filter((x) => x.name !== "ops_redeploy" && x.name !== "ops_scale")) {
      const t2 = t.name.startsWith("project_") || t.name.startsWith("app_") || t.name === "ops_ci_generate";
      expect(t.annotations?.readOnlyHint).toBe(!t2);
      expect(t.annotations?.destructiveHint).toBe(false);
      if (t2) expect(t.annotations?.openWorldHint).toBe(false);
      expect(t._meta).toBeUndefined();
    }
  });

  test("ops_ci_check (T0) y ops_ci_generate (T2): anotaciones y sin AWS; env obligatorio", async () => {
    const { client, call } = await connect();
    const { tools } = await client.listTools();
    expect(tools.find((x) => x.name === "ops_ci_check")!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const g = tools.find((x) => x.name === "ops_ci_generate")!;
    expect(g.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(g._meta).toBeUndefined();
    expect((await call("ops_ci_generate", { project: "demo" })).isError).toBe(true); // falta env: lo rechaza el esquema
  });

  test("ops_services/ops_tasks/ops_logs: T1, solo lectura, openWorld; env obligatorio; la lectura se audita", async () => {
    const { client, call, paths } = await connect({ "demo-stg": "111111111111" });
    const { tools } = await client.listTools();
    for (const name of ["ops_services", "ops_tasks", "ops_logs"]) {
      const t = tools.find((x) => x.name === name)!;
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
      expect(t._meta).toBeUndefined();
      expect((t.inputSchema as { required?: string[] }).required).toEqual(expect.arrayContaining(["project", "env"]));
    }
    expect((tools.find((x) => x.name === "ops_tasks")!.inputSchema as { required?: string[] }).required).toContain("service");
    expect((tools.find((x) => x.name === "ops_logs")!.inputSchema as { required?: string[] }).required).toContain("service");
    // sin env: el esquema lo rechaza (no hay default)
    await expect(client.callTool({ name: "ops_services", arguments: { project: "demo" } })).resolves.toMatchObject({ isError: true });
    await expect(client.callTool({ name: "ops_logs", arguments: { project: "demo", env: "staging", service: "demo-staging-app", limit: 5000 } })).resolves.toMatchObject({ isError: true });
    // proyecto sin `services`: falla cerrado y queda auditado como rechazado
    await registerDemoProject(paths);
    const r = await call("ops_services", { project: "demo", env: "staging" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no declara `services`");
    const audit = (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({ source: "mcp", tool: "ops_services", project: "demo", env: "staging", tier: "T1", decision: "rejected" });
  });

  test("ops_services por MCP con servicios declarados: lee y audita decision allowed", async () => {
    const { call, paths } = await connect({ "demo-stg": "111111111111" }, { runner: awsRunner({ "demo-stg": "111111111111" }, { "ecs describe-services": () => ({ services: [{ serviceName: "demo-staging-app", status: "ACTIVE", desiredCount: 1, runningCount: 1, pendingCount: 0 }], failures: [] }) }) });
    await registerDemoProject(paths, "", OPS_YAML_SERVICES());
    const r = await call("ops_services", { project: "demo", env: "staging" });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.text).services[0]).toMatchObject({ service: "demo-staging-app", status: "ACTIVE" });
    const audit = (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({ tool: "ops_services", env: "staging", tier: "T1", decision: "allowed" });
  });

  test("project_plan -> project_create por MCP: exige plan_id (nunca un spec) y audita en T2", async () => {
    const templates = await tempDir();
    const root = await tempDir();
    const paths = await tempPaths();
    await writeTemplates(templates);
    await write(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
    const { call, client } = await connect({}, { templatesDir: templates, paths, runner: exec });
    const target = join(root, "acme");
    const plan = await call("project_plan", { spec: SPEC, target });
    expect(plan.isError).toBe(false);
    const planId = JSON.parse(plan.text).plan_id as string;
    expect(planId).toMatch(/^plan_/);
    await expect(client.callTool({ name: "project_create", arguments: { spec: SPEC, target } })).resolves.toMatchObject({ isError: true });
    await expect(client.callTool({ name: "project_create", arguments: { plan_id: JSON.stringify(SPEC) } })).resolves.toMatchObject({ isError: true });
    const done = await call("project_create", { plan_id: planId });
    expect(done.isError).toBe(false);
    expect(JSON.parse(done.text)).toMatchObject({ ok: true, kind: "create" });
    const outside = await call("project_plan", { spec: SPEC, target: "/tmp/fuera/acme" });
    expect(outside.isError).toBe(true);
    const audit = (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(audit.filter((a) => String(a.tool).startsWith("project_")).every((a) => a.tier === "T2")).toBe(true);
    expect(audit.map((a) => a.tool)).toEqual(expect.arrayContaining(["project_plan", "project_create"]));
    expect(audit.find((a) => a.tool === "project_create" && a.decision === "allowed")).toBeDefined();
  });

  test("ops_status sin proyectos y con proyecto no registrado", async () => {
    const { call } = await connect();
    expect(JSON.parse((await call("ops_status")).text)).toMatchObject({ projects: [] });
    const r = await call("ops_status", { project: "demo" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no está registrado");
  });

  test("ops_status no acepta rutas libres como proyecto", async () => {
    const { client } = await connect();
    await expect(client.callTool({ name: "ops_status", arguments: { project: "/etc" } })).resolves.toMatchObject({ isError: true });
  });

  test("ops_status con proyecto: política por entorno, perfil desconocido en prod => disabled, y se audita", async () => {
    const { paths, call, runner } = await connect({ "demo-stg": "111111111111", "demo-prod": "222222222222" });
    await registerDemoProject(paths);
    const out = JSON.parse((await call("ops_status", { project: "demo" })).text);
    const by = Object.fromEntries(out.environments.map((e: { env: string }) => [e.env, e]));
    expect(by.staging.policy).toMatchObject({ status: "allowed", effective_mode: "command-only" });
    expect(by.prod.policy.status).toBe("disabled");
    expect(runner.calls.every((c) => c[1] === "sts")).toBe(true);
    const audit = (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(audit.at(-1)).toMatchObject({ tool: "ops_status", project: "demo", tier: "T1", decision: "allowed" });
  });

  test("ops_status con env explícito y gated-apply reportado como command-only", async () => {
    const { paths, call } = await connect({ "demo-prod": "222222222222" });
    await registerDemoProject(paths);
    await write(join(paths.configDir, "policy.yaml"), "aws_profiles:\n  demo-prod:\n    account_id: '222222222222'\n    production_mode: gated-apply\n");
    const out = JSON.parse((await call("ops_status", { project: "demo", env: "prod" })).text);
    expect(out.environments).toHaveLength(1);
    expect(out.environments[0].policy).toMatchObject({ status: "allowed", requested_mode: "gated-apply", effective_mode: "command-only" });
  });

  test("policy.yaml inválida => todo disabled", async () => {
    const { paths, call } = await connect({ "demo-stg": "111111111111" });
    await registerDemoProject(paths);
    await write(join(paths.configDir, "policy.yaml"), "default_mode: nope\n");
    const out = JSON.parse((await call("ops_status", { project: "demo" })).text);
    expect(out.policy_error).toContain("policy.yaml inválido");
    expect(out.environments.every((e: { policy: { status: string } }) => e.policy.status === "disabled")).toBe(true);
  });

  test("log_read: lee por referencia y rechaza path traversal", async () => {
    const { ctx, call } = await connect();
    const w = await ctx.logs.write("demo", "hola\nexport A_TOKEN='x y'\nfin");
    const ok = await call("log_read", { ref: w.ref, grep: "fin" });
    expect(ok.isError).toBe(false);
    expect(ok.text).toContain("<untrusted-data");
    expect(ok.text).not.toContain("x y");
    for (const ref of ["../../etc/passwd", "/etc/passwd", "..\\..\\x.log"]) {
      const bad = await call("log_read", { ref });
      expect(bad.isError).toBe(true);
    }
  });
});

describe("catálogo", () => {
  test("mapeo tier -> anotaciones; requiresUserInteraction solo en T3, dentro de _meta", () => {
    expect(annotationsForTier("T0", false)).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(annotationsForTier("T1", true)).toMatchObject({ readOnlyHint: true, openWorldHint: true });
    expect(annotationsForTier("T2", true)).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotationsForTier("T3", true)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(metaForTier("T2")).toBeUndefined();
    expect(metaForTier("T3")).toEqual({ "anthropic/requiresUserInteraction": true });
    expect(effectiveTier("T2", { is_production: true })).toBe("T3");
    expect(effectiveTier("T2", { is_production: false })).toBe("T2");
    expect(effectiveTier("T2", { name: "prod", is_production: false })).toBe("T3"); // el nombre también cuenta
    expect(effectiveTier("T2", { name: "live", is_production: false }, ["live"])).toBe("T3");
    expect(effectiveTier("T1", { is_production: true })).toBe("T1");
  });
  test("las operaciones T2 son project_* y app_* (sin AWS) y ops_ci_generate; las únicas T3 son ops_redeploy y ops_scale (solo devuelven el comando); las lecturas AWS son T1", () => {
    for (const n of ["ops_services", "ops_tasks", "ops_logs"]) expect(listOperations().find((o) => o.name === n)).toMatchObject({ tier: "T1", usesAws: true });
    expect(listOperations().find((o) => o.name === "ops_env_check")).toMatchObject({ tier: "T0", usesAws: false });
    expect(listOperations().find((o) => o.name === "ops_ci_check")).toMatchObject({ tier: "T0", usesAws: false });
    expect(listOperations().find((o) => o.name === "ops_ci_generate")).toMatchObject({ tier: "T2", usesAws: false });
    const changing = listOperations().filter((o) => o.tier === "T2" || o.tier === "T3");
    expect(changing.map((o) => o.name).sort()).toEqual(["app_create", "app_plan", "ops_ci_generate", "ops_redeploy", "ops_scale", "project_create", "project_plan", "project_verify"]);
    expect(changing.filter((o) => o.tier === "T2").every((o) => o.tier === "T2" && !o.usesAws)).toBe(true);
    expect(changing.filter((o) => o.tier === "T3").map((o) => o.name).sort()).toEqual(["ops_redeploy", "ops_scale"]);
    for (const n of ["ops_redeploy", "ops_scale"]) expect(listOperations().find((o) => o.name === n)).toMatchObject({ tier: "T3", usesAws: true });
  });
});

describe("higiene", () => {
  test("ningún archivo de src escribe a stdout (canal del protocolo) salvo --version", async () => {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    await walk(join(import.meta.dirname, "..", "src"));
    for (const f of files) {
      const text = await readFile(f, "utf8");
      expect(text, f).not.toMatch(/console\.(log|info|debug)\(/);
      if (!f.endsWith("cli.ts")) expect(text, f).not.toMatch(/process\.stdout/);
    }
  });
});
