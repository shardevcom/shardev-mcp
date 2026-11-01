import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { runOps, USAGE, type CliIo } from "../src/cli-run.js";
import { auditFile } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { awsRunner } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempDir, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

const ALL_ACCOUNTS = { "demo-stg": "111111111111", "demo-prod": "222222222222" };
const PROD_POLICY = "aws_profiles:\n  demo-prod:\n    account_id: '222222222222'\n    production_mode: command-only\n";
const ok = (id: string) => () => ({ service: { serviceName: "x", desiredCount: 2, deployments: [{ id, status: "PRIMARY" }], overrides: { secret: "NO" } } });

interface Opts {
  line?: string | null;
  tty?: { stdin: boolean; stderr: boolean };
  accounts?: Record<string, string | "expired">;
  policy?: string;
  update?: (args: readonly string[]) => object;
  yaml?: string;
}

async function setup(o: Opts = {}) {
  const paths = await tempPaths();
  await registerDemoProject(paths, "", o.yaml ?? OPS_YAML_SERVICES());
  if (o.policy) await write(join(paths.configDir, "policy.yaml"), o.policy);
  const runner = awsRunner(o.accounts ?? ALL_ACCOUNTS, { "ecs update-service": o.update ?? ((a) => ok(`ecs-svc/${a[a.indexOf("--service") + 1]}`)()) });
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

const STG = ["redeploy", "--project", "demo", "--env", "staging"];

describe("shardev ops redeploy", () => {
  test("staging --service: argv exacto, resultado JSON en stdout, resumen en stderr, auditoría intent -> result", async () => {
    const s = await setup();
    expect(await runOps([...STG, "--service", "demo-staging-app", "--json"], s.io, s.ctx)).toBe(0);
    expect(s.updates()).toEqual([["aws", "ecs", "update-service", "--cluster", "shared", "--service", "demo-staging-app", "--force-new-deployment", "--profile", "demo-stg", "--region", "us-east-1", "--output", "json", "--no-cli-pager"]]);
    const res = JSON.parse(s.out.join(""));
    expect(res).toMatchObject({ project: "demo", env: "staging", production: false, services: [{ service: "demo-staging-app", state: "done", deployment_id: "ecs-svc/demo-staging-app" }] });
    expect(res.next).toContain("shardev ops services --project demo --env staging");
    expect(res.next).toContain("iniciado");
    expect(res.next).not.toMatch(/completado/i);
    expect(s.out.join("")).not.toContain("NO"); // nunca se reenvía la salida cruda ni overrides
    expect(s.err.join("")).toContain("PRODUCCIÓN: no");
    expect(s.err.join("")).toContain("111111111111");
    expect(s.err.join("")).toContain("demo/staging");
    const a = await s.audit();
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ source: "cli", tool: "ops_redeploy", tier: "T3", phase: "intent", decision: "allowed", exit_code: null, args: { project: "demo", env: "staging", service: "demo-staging-app" } });
    expect(a[1]).toMatchObject({ source: "cli", tool: "ops_redeploy", tier: "T3", phase: "result", decision: "allowed", exit_code: 0 });
  });

  test("--all en producción: todos los servicios en orden, PRODUCCIÓN sí, frase demo/prod", async () => {
    const s = await setup({ line: "demo/prod", policy: PROD_POLICY });
    expect(await runOps(["redeploy", "--project", "demo", "--env", "prod", "--all"], s.io, s.ctx)).toBe(0);
    expect(s.updates().map((c) => c[c.indexOf("--service") + 1])).toEqual(["demo-app", "demo-worker"]);
    expect(s.updates()[0]).toContain("demo-prod");
    expect(s.err.join("")).toContain("PRODUCCIÓN: SÍ");
    expect(s.out.join("")).toContain("INICIADO");
    expect(s.out.join("")).not.toMatch(/completado/i);
  });

  test("gated-apply también exige la misma confirmación", async () => {
    const s = await setup({ line: "demo/prod", policy: PROD_POLICY.replace("command-only", "gated-apply") });
    expect(await runOps(["redeploy", "--project", "demo", "--env", "prod", "--service", "demo-app"], s.io, s.ctx)).toBe(0);
    expect(s.reads()).toBe(1);
  });

  test("sin confirmación válida no hay llamada a ecs: no_tty, stderr sin TTY, frase errónea, caso, vacía y EOF", async () => {
    const cases: Opts[] = [{ tty: { stdin: false, stderr: true } }, { tty: { stdin: true, stderr: false } }, { line: "demo/prod" }, { line: "Demo/Staging" }, { line: "" }, { line: null }];
    for (const c of cases) {
      const s = await setup(c);
      const out = s.out;
      expect(await runOps([...STG, "--all"], s.io, s.ctx)).toBe(1);
      expect(s.updates()).toHaveLength(0);
      expect(out.join("")).toContain("No se cambió nada");
      const a = await s.audit();
      expect(a).toHaveLength(1);
      expect(a[0]).toMatchObject({ phase: "result", decision: "rejected", exit_code: 1 });
      if (c.tty?.stdin === false) expect(s.reads()).toBe(0);
    }
  });

  test("disabled, sin sesión, cuenta distinta, servicio ajeno, sin objetivo o ambos: sin prompt ni ecs", async () => {
    const cases: Array<[Opts, string[]]> = [
      [{}, ["redeploy", "--project", "demo", "--env", "prod", "--all"]], // prod sin perfil en policy => disabled
      [{ accounts: { "demo-stg": "expired" } }, [...STG, "--all"]],
      [{ accounts: { "demo-stg": "999999999999" } }, [...STG, "--all"]],
      [{}, [...STG, "--service", "demo-app"]],
      [{}, STG],
      [{}, [...STG, "--service", "demo-staging-app", "--all"]],
    ];
    for (const [o, argv] of cases) {
      const s = await setup(o);
      expect(await runOps(argv, s.io, s.ctx)).toBe(1);
      expect(s.updates()).toHaveLength(0);
      expect(s.reads()).toBe(0);
      expect(s.err.join("")).not.toContain("Para confirmar");
    }
  });

  test("--yes, --force y cualquier flag desconocido fallan en lugar de ignorarse", async () => {
    for (const f of ["--yes", "--force", "--wait", "--bogus", "-y"]) {
      const s = await setup();
      await expect(runOps([...STG, "--all", f], s.io, s.ctx)).rejects.toThrow(f === "-y" ? /Argumento no admitido/ : /Flag no admitida/);
      expect(s.updates()).toHaveLength(0);
      expect(s.reads()).toBe(0);
      expect((await s.audit()).at(-1)).toMatchObject({ tool: "ops_redeploy", decision: "rejected", phase: "result" });
    }
    const s = await setup();
    await expect(runOps([...STG, "--all=si"], s.io, s.ctx)).rejects.toThrow(/--all no admite valor/);
  });

  test("si la auditoría de intención falla, no se cambia AWS y sale con 1", async () => {
    const s = await setup();
    s.ctx.audit.record = async () => {
      throw new Error("disco lleno");
    };
    expect(await runOps([...STG, "--all"], s.io, s.ctx)).toBe(1);
    expect(s.updates()).toHaveLength(0);
    expect(s.out.join("")).toContain("auditoría de intención");
    expect(s.out.join("")).toContain("No se cambió nada");
  });

  test("falla el 2º de 3 servicios: done/failed/not_attempted, el 3º no se llama, exit 1", async () => {
    const yaml = OPS_YAML_SERVICES().replace("services: [demo-staging-app, demo-staging-worker]", "services: [demo-staging-app, demo-staging-worker, demo-staging-cron]");
    const s = await setup({ yaml, update: (a) => (a.includes("demo-staging-worker") ? { exitCode: 1, stderr: "AccessDenied API_TOKEN=zzz-secreto-distintivo" } : ok("d-1")()) });
    expect(await runOps([...STG, "--all", "--json"], s.io, s.ctx)).toBe(1);
    const res = JSON.parse(s.out.join(""));
    expect(res.services.map((x: { state: string }) => x.state)).toEqual(["done", "failed", "not_attempted"]);
    expect(s.updates()).toHaveLength(2);
    expect(s.out.join("")).not.toContain("zzz-secreto-distintivo");
    expect(res.services[1].reason).toContain("falló");
    expect(await readFile(auditFile(s.paths), "utf8")).not.toContain("zzz-secreto-distintivo");
    expect((await s.audit()).at(-1)).toMatchObject({ phase: "result", decision: "error", exit_code: 1 });
  });

  test("timeout: estado unknown con aviso de verificar, y se detiene", async () => {
    const s = await setup({ update: (a) => (a.includes("demo-staging-app") ? { timedOut: true, exitCode: null } : ok("d")()) });
    expect(await runOps([...STG, "--all", "--json"], s.io, s.ctx)).toBe(1);
    const res = JSON.parse(s.out.join(""));
    expect(res.services.map((x: { state: string }) => x.state)).toEqual(["unknown", "not_attempted"]);
    expect(res.services[0].reason).toContain("shardev ops services");
    expect(s.updates()).toHaveLength(1);
  });

  test("sesión que caduca a mitad: fallo con el comando de login", async () => {
    const s = await setup({ update: () => ({ exitCode: 255, stderr: "Error when retrieving token from sso: Token has expired and refresh failed" }) });
    expect(await runOps([...STG, "--all"], s.io, s.ctx)).toBe(1);
    expect(s.out.join("")).toContain("aws sso login");
  });

  test("la ayuda documenta el comando y ya no dice que ops es solo lectura sin matices", () => {
    expect(USAGE).toContain("ops redeploy --project");
    expect(USAGE).toContain("redeploy es la excepción");
    expect(USAGE).toContain("no existe --yes ni --force");
  });
});

describe("el servidor MCP no puede alcanzar el ejecutor", () => {
  test("ni core/aws-change ni ops/redeploy-exec son alcanzables desde src/server.ts", async () => {
    const seen = new Set<string>();
    const walk = async (file: string): Promise<void> => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        const target = resolve(dirname(file), m[1]!.replace(/\.js$/, ".ts"));
        await walk(target);
      }
    };
    await walk(resolve("src/server.ts"));
    const names = [...seen].map((f) => f.slice(resolve("src").length + 1));
    expect(names).toContain("ops/redeploy.ts");
    expect(names).not.toContain("core/aws-change.ts");
    expect(names).not.toContain("ops/redeploy-exec.ts");
    expect(names).not.toContain("cli-run.ts");
  });
});

describe("proceso real con un aws falso en PATH", () => {
  const dist = resolve("node_modules/.cache/shardev-test-dist");
  beforeAll(() => {
    const r = spawnSync("npx", ["tsc", "-p", "tsconfig.build.json", "--outDir", dist], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`tsc: ${r.stdout}${r.stderr}`);
  }, 60_000);

  test("la frase correcta por tubería no ejecuta update-service", async () => {
    const home = await tempDir();
    const bin = await tempDir();
    const log = join(home, "aws.log");
    await writeFile(join(bin, "aws"), `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = sts ]; then echo '{"UserId":"X","Account":"111111111111","Arn":"arn:aws:iam::111111111111:user/t"}'; else echo '{}'; fi\n`);
    await chmod(join(bin, "aws"), 0o755);
    const cfg = join(home, ".config", "shardev-mcp");
    await mkdir(cfg, { recursive: true });
    const proj = await tempDir();
    await writeFile(join(proj, "ops.yaml"), OPS_YAML_SERVICES());
    await writeFile(join(cfg, "projects.yaml"), `projects:\n  demo:\n    path: ${proj}\n`);
    const r = spawnSync(process.execPath, [join(dist, "cli.js"), "ops", "redeploy", "--project", "demo", "--env", "staging", "--all"], {
      input: "demo/staging\n",
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: home },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("No se cambió nada");
    const calls = await readFile(log, "utf8");
    expect(calls).toContain("sts get-caller-identity");
    expect(calls).not.toContain("update-service");
    expect(await readdir(join(home, ".local", "state", "shardev-mcp"))).toContain("audit.jsonl");
  }, 30_000);
});
