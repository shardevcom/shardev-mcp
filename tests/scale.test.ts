import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { runOps, USAGE, type CliIo } from "../src/cli-run.js";
import { auditFile } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { createServer } from "../src/server.js";
import { awsRunner } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempDir, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

const ACCOUNTS = { "demo-stg": "111111111111", "demo-prod": "222222222222" };
const PROD_POLICY = "aws_profiles:\n  demo-prod:\n    account_id: '222222222222'\n    production_mode: command-only\n";
const svcArg = (a: readonly string[]) => a[a.indexOf("--service") + 1];
const NO_COMMAND = (t: string) => expect(t).not.toContain("shardev ops scale");

describe("ops_scale por MCP (T3, solo devuelve el comando)", () => {
  async function mcp(accounts: Record<string, string | "expired"> = ACCOUNTS, policy?: string) {
    const paths = await tempPaths();
    await registerDemoProject(paths, "", OPS_YAML_SERVICES());
    if (policy) await write(join(paths.configDir, "policy.yaml"), policy);
    const runner = awsRunner(accounts);
    const { server } = createServer({ paths, runner });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (args: Record<string, unknown>) => {
      const r = (await client.callTool({ name: "ops_scale", arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      return { text: r.content[0]?.text ?? "", isError: r.isError === true };
    };
    const audit = async () => (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    return { runner, client, call, audit };
  }

  test("anotaciones T3 y desired_count obligatorio en el esquema", async () => {
    const { client } = await mcp();
    const t = (await client.listTools()).tools.find((x) => x.name === "ops_scale")!;
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(t._meta).toMatchObject({ "anthropic/requiresUserInteraction": true });
    expect((t.inputSchema as { required?: string[] }).required).toEqual(expect.arrayContaining(["project", "env", "desired_count"]));
  });

  test("staging y producción: comando exacto, solo la llamada de identidad, auditoría T3", async () => {
    const stg = await mcp();
    const r = await stg.call({ project: "demo", env: "staging", service: "demo-staging-app", desired_count: 3 });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("shardev ops scale --project demo --env staging --service demo-staging-app --desired-count 3");
    expect(r.text).toContain("producción: no");
    expect(stg.runner.calls.every((c) => c[1] === "sts" && c[2] === "get-caller-identity")).toBe(true);
    expect((await stg.audit()).at(-1)).toMatchObject({ source: "mcp", tool: "ops_scale", tier: "T3", decision: "command-only" });

    const prod = await mcp(ACCOUNTS, PROD_POLICY);
    const p = await prod.call({ project: "demo", env: "prod", all: true, desired_count: 2 });
    expect(p.text).toContain("shardev ops scale --project demo --env prod --all --desired-count 2");
    expect(p.text).toContain("producción: sí");
    expect(prod.runner.calls.every((c) => c[1] === "sts")).toBe(true);
    expect(prod.runner.reads).toHaveLength(0);
  });

  test("con 0 avisa de que los servicios quedan fuera de línea", async () => {
    const { call } = await mcp();
    const r = await call({ project: "demo", env: "staging", all: true, desired_count: 0 });
    expect(r.text).toContain("FUERA DE LÍNEA");
    expect(r.text).toContain("--desired-count 0");
    expect((await call({ project: "demo", env: "staging", all: true, desired_count: 2 })).text).not.toContain("FUERA DE LÍNEA");
  });

  test("desired_count inválido o ausente, objetivo inválido y estados de política: sin comando", async () => {
    const { call } = await mcp();
    for (const dc of [21, -1, 1.5, "3", null, undefined]) {
      const r = await call({ project: "demo", env: "staging", all: true, ...(dc === undefined ? {} : { desired_count: dc }) });
      expect(r.isError).toBe(true);
      NO_COMMAND(r.text);
    }
    for (const t of [{}, { service: "demo-staging-app", all: true }, { service: "demo-app" }, { service: "x; rm -rf /" }, { all: true, extra: 1 }]) {
      const r = await call({ project: "demo", env: "staging", desired_count: 1, ...t });
      expect(r.isError).toBe(true);
      NO_COMMAND(r.text);
    }
    NO_COMMAND((await call({ project: "demo", env: "prod", all: true, desired_count: 1 })).text); // disabled
    expect((await (await mcp({ "demo-stg": "999999999999" })).call({ project: "demo", env: "staging", all: true, desired_count: 1 })).isError).toBe(true);
    const ex = await mcp({ "demo-stg": "expired" });
    const r = await ex.call({ project: "demo", env: "staging", all: true, desired_count: 1 });
    expect(r.isError).toBe(true);
    NO_COMMAND(r.text);
    expect((await ex.audit()).at(-1)).toMatchObject({ tool: "ops_scale", tier: "T3", decision: "unavailable" });
  });
});

interface Opts {
  line?: string | null;
  tty?: { stdin: boolean; stderr: boolean };
  accounts?: Record<string, string | "expired">;
  policy?: string;
  current?: Record<string, number>;
  describe?: (a: readonly string[]) => object;
  update?: (a: readonly string[]) => object;
  yaml?: string;
}

async function setup(o: Opts = {}) {
  const paths = await tempPaths();
  await registerDemoProject(paths, "", o.yaml ?? OPS_YAML_SERVICES());
  if (o.policy) await write(join(paths.configDir, "policy.yaml"), o.policy);
  const current = o.current ?? { "demo-staging-app": 1, "demo-staging-worker": 1, "demo-app": 2, "demo-worker": 2, "demo-staging-cron": 1 };
  const runner = awsRunner(o.accounts ?? ACCOUNTS, {
    "ecs describe-services": o.describe ?? ((a) => {
      const names = a.slice(a.indexOf("--services") + 1).filter((x) => !x.startsWith("--"));
      return { services: names.filter((n) => n in current).map((n) => ({ serviceName: n, desiredCount: current[n], runningCount: current[n] })), failures: [] };
    }),
    "ecs update-service": o.update ?? ((a) => ({ service: { serviceName: svcArg(a), desiredCount: Number(a[a.indexOf("--desired-count") + 1]), deployments: [{ id: "NO", status: "PRIMARY" }] } })),
  });
  const ctx = createContext(paths, { runner });
  const out: string[] = [];
  const err: string[] = [];
  const tty = o.tty ?? { stdin: true, stderr: true };
  let reads = 0;
  const line = o.line === undefined ? "demo/staging" : o.line;
  const io: CliIo = { out: (s) => out.push(s), err: (s) => err.push(s), stdin: async () => "", isTty: (s) => tty[s], readLine: async () => (reads++, line) };
  const updates = () => runner.calls.filter((c) => c[1] === "ecs" && c[2] === "update-service");
  const audit = async () => (await readFile(auditFile(paths), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  return { paths, ctx, runner, io, out, err, updates, audit, reads: () => reads };
}
const STG = ["scale", "--project", "demo", "--env", "staging"];

describe("shardev ops scale", () => {
  test("camino feliz: argv exacto sin --force-new-deployment, estado actual en el resumen, auditoría intent -> result", async () => {
    const s = await setup();
    expect(await runOps([...STG, "--service", "demo-staging-app", "--desired-count", "3", "--json"], s.io, s.ctx)).toBe(0);
    expect(s.updates()).toEqual([["aws", "ecs", "update-service", "--cluster", "shared", "--service", "demo-staging-app", "--desired-count", "3", "--profile", "demo-stg", "--region", "us-east-1", "--output", "json", "--no-cli-pager"]]);
    expect(s.runner.reads[0]).toContain("describe-services");
    expect(s.err.join("")).toContain("deseadas 1 / en ejecución 1 -> 3");
    const res = JSON.parse(s.out.join(""));
    expect(res).toMatchObject({ production: false, services: [{ service: "demo-staging-app", state: "done", desired_count: 3 }] });
    expect(JSON.stringify(res)).not.toContain("NO"); // solo la lista blanca
    expect(res.next).toContain("iniciado");
    expect(res.next).not.toMatch(/completado/i);
    const a = await s.audit();
    expect(a.map((x) => [x.phase, x.decision, x.exit_code])).toEqual([["intent", "allowed", null], ["result", "allowed", 0]]);
    expect(a[0]).toMatchObject({ tool: "ops_scale", tier: "T3", source: "cli", args: { desired_count: 3, service: "demo-staging-app" } });
  });

  test("producción --all con N>0: frase plana, PRODUCCIÓN sí", async () => {
    const s = await setup({ line: "demo/prod", policy: PROD_POLICY });
    expect(await runOps(["scale", "--project", "demo", "--env", "prod", "--all", "--desired-count", "4"], s.io, s.ctx)).toBe(0);
    expect(s.updates().map(svcArg)).toEqual(["demo-app", "demo-worker"]);
    expect(s.err.join("")).toContain("PRODUCCIÓN: SÍ");
  });

  test("0 exige <p>/<e>/apagar: la frase plana se rechaza y con 'apagar' se ejecuta; avisa de fuera de línea", async () => {
    const plain = await setup();
    expect(await runOps([...STG, "--all", "--desired-count", "0"], plain.io, plain.ctx)).toBe(1);
    expect(plain.updates()).toHaveLength(0);
    expect(plain.err.join("")).toContain("FUERA DE LÍNEA");
    expect(plain.err.join("")).toContain("autoscaling");
    expect(plain.err.join("")).toContain("demo/staging/apagar");
    const off = await setup({ line: "demo/staging/apagar" });
    expect(await runOps([...STG, "--all", "--desired-count", "0"], off.io, off.ctx)).toBe(0);
    expect(off.updates()).toHaveLength(2);
    expect(off.updates()[0]).toContain("0");
  });

  test("N>0 con la frase de apagar se rechaza", async () => {
    const s = await setup({ line: "demo/staging/apagar" });
    expect(await runOps([...STG, "--all", "--desired-count", "2"], s.io, s.ctx)).toBe(1);
    expect(s.updates()).toHaveLength(0);
  });

  test("ya está en N: exit 0, sin prompt, sin update-service, sin entrada de intención", async () => {
    const s = await setup({ current: { "demo-staging-app": 2, "demo-staging-worker": 2 } });
    expect(await runOps([...STG, "--all", "--desired-count", "2", "--json"], s.io, s.ctx)).toBe(0);
    expect(s.reads()).toBe(0);
    expect(s.updates()).toHaveLength(0);
    const res = JSON.parse(s.out.join(""));
    expect(res.services.map((x: { state: string }) => x.state)).toEqual(["unchanged", "unchanged"]);
    expect(res.next).toContain("Sin cambios");
    const a = await s.audit();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ phase: "result", decision: "allowed", exit_code: 0 });
  });

  test("objetivo mixto: solo cambia el que difiere y el otro queda unchanged sin llamada", async () => {
    const s = await setup({ current: { "demo-staging-app": 2, "demo-staging-worker": 1 } });
    expect(await runOps([...STG, "--all", "--desired-count", "2", "--json"], s.io, s.ctx)).toBe(0);
    expect(s.updates().map(svcArg)).toEqual(["demo-staging-worker"]);
    expect(JSON.parse(s.out.join("")).services.map((x: { state: string }) => x.state)).toEqual(["unchanged", "done"]);
  });

  test("falla la lectura previa o falta un servicio en la respuesta: sin prompt ni cambio", async () => {
    for (const describe of [() => ({ exitCode: 1, stderr: "AccessDenied" }), () => ({ services: [{ serviceName: "demo-staging-app", desiredCount: 1, runningCount: 1 }], failures: [] }), () => ({ exitCode: 255, stderr: "Token has expired and refresh failed" })]) {
      const s = await setup({ describe });
      expect(await runOps([...STG, "--all", "--desired-count", "3"], s.io, s.ctx)).toBe(1);
      expect(s.reads()).toBe(0);
      expect(s.updates()).toHaveLength(0);
      expect(s.out.join("")).toContain("No se cambió nada");
      expect(await s.audit()).toHaveLength(1);
    }
  });

  test("sin TTY, EOF, frase errónea, disabled, cuenta distinta, sin sesión, servicio ajeno o sin objetivo: sin update-service", async () => {
    const cases: Array<[Opts, string[]]> = [
      [{ tty: { stdin: false, stderr: true } }, [...STG, "--all", "--desired-count", "3"]],
      [{ line: null }, [...STG, "--all", "--desired-count", "3"]],
      [{ line: "demo/prod" }, [...STG, "--all", "--desired-count", "3"]],
      [{}, ["scale", "--project", "demo", "--env", "prod", "--all", "--desired-count", "3"]],
      [{ accounts: { "demo-stg": "999999999999" } }, [...STG, "--all", "--desired-count", "3"]],
      [{ accounts: { "demo-stg": "expired" } }, [...STG, "--all", "--desired-count", "3"]],
      [{}, [...STG, "--service", "demo-app", "--desired-count", "3"]],
      [{}, [...STG, "--desired-count", "3"]],
      [{}, [...STG, "--all", "--service", "demo-staging-app", "--desired-count", "3"]],
    ];
    for (const [o, argv] of cases) {
      const s = await setup(o);
      expect(await runOps(argv, s.io, s.ctx)).toBe(1);
      expect(s.updates()).toHaveLength(0);
    }
  });

  test("--desired-count inválido o ausente se rechaza antes de cualquier otra cosa", async () => {
    for (const v of ["1.5", "-1", "abc", "21", "", "1e1"]) {
      const s = await setup();
      await expect(runOps([...STG, "--all", "--desired-count", v], s.io, s.ctx)).rejects.toThrow(/desired-count/);
      expect(s.runner.calls).toHaveLength(0);
    }
    const s = await setup();
    await expect(runOps([...STG, "--all"], s.io, s.ctx)).rejects.toThrow(/Falta --desired-count/);
    await expect(runOps([...STG, "--all", "--desired-count"], s.io, s.ctx)).rejects.toThrow(/necesita un valor/);
    expect(s.runner.calls).toHaveLength(0);
    expect((await s.audit()).at(-1)).toMatchObject({ tool: "ops_scale", decision: "rejected" }); // el error de parseArgs ocurre antes de saber la fase
  });

  test("--yes, --force y flags desconocidos fallan; --desired-count no existe en redeploy", async () => {
    for (const f of ["--yes", "--force", "--wait", "-y"]) {
      const s = await setup();
      await expect(runOps([...STG, "--all", "--desired-count", "3", f], s.io, s.ctx)).rejects.toThrow(/no admitid/i);
      expect(s.runner.calls).toHaveLength(0);
    }
    const s = await setup();
    await expect(runOps(["redeploy", "--project", "demo", "--env", "staging", "--all", "--desired-count", "3"], s.io, s.ctx)).rejects.toThrow(/Flag no admitida/);
  });

  test("falla la auditoría de intención: no se llama a update-service", async () => {
    const s = await setup();
    s.ctx.audit.record = async () => {
      throw new Error("disco lleno");
    };
    expect(await runOps([...STG, "--all", "--desired-count", "3"], s.io, s.ctx)).toBe(1);
    expect(s.updates()).toHaveLength(0);
    expect(s.out.join("")).toContain("auditoría de intención");
  });

  test("falla el 2º de 3: done/failed/not_attempted, el 3º no se llama, secreto redactado", async () => {
    const yaml = OPS_YAML_SERVICES().replace("services: [demo-staging-app, demo-staging-worker]", "services: [demo-staging-app, demo-staging-worker, demo-staging-cron]");
    const s = await setup({ yaml, update: (a) => (svcArg(a) === "demo-staging-worker" ? { exitCode: 1, stderr: "AccessDenied API_TOKEN=zzz-secreto-distintivo" } : { service: { desiredCount: 3 } }) });
    expect(await runOps([...STG, "--all", "--desired-count", "3", "--json"], s.io, s.ctx)).toBe(1);
    expect(JSON.parse(s.out.join("")).services.map((x: { state: string }) => x.state)).toEqual(["done", "failed", "not_attempted"]);
    expect(s.updates()).toHaveLength(2);
    expect(s.out.join("") + (await readFile(auditFile(s.paths), "utf8"))).not.toContain("zzz-secreto-distintivo");
    expect((await s.audit()).at(-1)).toMatchObject({ phase: "result", decision: "error", exit_code: 1 });
  });

  test("timeout: unknown con aviso de verificar, y se detiene", async () => {
    const s = await setup({ update: (a) => (svcArg(a) === "demo-staging-app" ? { timedOut: true, exitCode: null } : {}) });
    expect(await runOps([...STG, "--all", "--desired-count", "3", "--json"], s.io, s.ctx)).toBe(1);
    const res = JSON.parse(s.out.join(""));
    expect(res.services.map((x: { state: string }) => x.state)).toEqual(["unknown", "not_attempted"]);
    expect(res.services[0].reason).toContain("shardev ops services");
    expect(s.updates()).toHaveLength(1);
  });

  test("la ayuda documenta scale", () => {
    expect(USAGE).toContain("ops scale --project");
    expect(USAGE).toContain("--desired-count <0-20>");
    expect(USAGE).toContain("<proyecto>/<entorno>/apagar");
  });
});

describe("el servidor MCP no alcanza ningún ejecutor", () => {
  test("change-exec, redeploy-exec, scale-exec y aws-change no son alcanzables desde src/server.ts", async () => {
    const seen = new Set<string>();
    const walk = async (file: string): Promise<void> => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of (await readFile(file, "utf8")).matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) await walk(resolve(dirname(file), m[1]!.replace(/\.js$/, ".ts")));
    };
    await walk(resolve("src/server.ts"));
    const names = [...seen].map((f) => f.slice(resolve("src").length + 1));
    expect(names).toEqual(expect.arrayContaining(["ops/redeploy.ts", "ops/scale.ts", "ops/change-command.ts"]));
    for (const n of ["core/aws-change.ts", "ops/change-exec.ts", "ops/redeploy-exec.ts", "ops/scale-exec.ts", "cli-run.ts"]) expect(names).not.toContain(n);
  });
});

describe("proceso real con un aws falso en PATH", () => {
  const dist = resolve("node_modules/.cache/shardev-test-dist-scale");
  beforeAll(() => {
    const r = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", dist], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tsc: ${r.stdout}${r.stderr}`);
  }, 60_000);

  test("la frase correcta por tubería no ejecuta update-service", async () => {
    const home = await tempDir();
    const bin = await tempDir();
    const log = join(home, "aws.log");
    await writeFile(join(bin, "aws"), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$1 $2" in\n"sts get-caller-identity") echo '{"UserId":"X","Account":"111111111111","Arn":"arn:aws:iam::111111111111:user/t"}';;\n"ecs describe-services") echo '{"services":[{"serviceName":"demo-staging-app","desiredCount":1,"runningCount":1},{"serviceName":"demo-staging-worker","desiredCount":1,"runningCount":1}],"failures":[]}';;\n*) echo '{}';;\nesac\n`);
    await chmod(join(bin, "aws"), 0o755);
    await mkdir(join(home, ".config", "shardev-mcp"), { recursive: true });
    const proj = await tempDir();
    await writeFile(join(proj, "ops.yaml"), OPS_YAML_SERVICES());
    await writeFile(join(home, ".config", "shardev-mcp", "projects.yaml"), `projects:\n  demo:\n    path: ${proj}\n`);
    const r = spawnSync(process.execPath, [join(dist, "cli.js"), "ops", "scale", "--project", "demo", "--env", "staging", "--all", "--desired-count", "3"], { input: "demo/staging\n", encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, HOME: home } });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("No se cambió nada");
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("describe-services");
    expect(calls).not.toContain("update-service");
  }, 30_000);
});
