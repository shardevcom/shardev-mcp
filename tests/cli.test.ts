import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runOps, runProject, USAGE, type CliIo } from "../src/cli-run.js";
import { createContext } from "../src/ops/context.js";
import { logRead } from "../src/ops/log-read.js";
import { awsRunner, cwLogs } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempPaths, write } from "./helpers/fixtures.js";
import { SPEC, setup } from "./helpers/gen-fixtures.js";

function io(stdin = ""): { io: CliIo; out: string[] } {
  const out: string[] = [];
  return { out, io: { out: (s) => out.push(s), err: () => undefined, stdin: async () => stdin } };
}

describe("shardev project (misma lógica que las herramientas)", () => {
  test("plan --json, create y verify comparten resultado con las funciones de ops", async () => {
    const { ctx, root, paths } = await setup();
    const target = join(root, "acme");
    const a = io(JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", "-", "--target", target, "--json"], a.io, ctx)).toBe(0);
    const plan = JSON.parse(a.out.join(""));
    expect(plan.plan_id).toMatch(/^plan_/);

    const b = io();
    expect(await runProject(["create", "--plan-id", plan.plan_id, "--json"], b.io, ctx)).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ ok: true, kind: "create", target });

    await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  acme:\n    path: ${target}\n`);
    const c = io();
    expect(await runProject(["verify", "--project", "acme", "--json"], c.io, ctx)).toBe(0);
    expect(JSON.parse(c.out.join(""))).toMatchObject({ ok: true, project: "acme" });
  });

  test("salida humana y errores de uso", async () => {
    const { ctx, root } = await setup();
    const a = io();
    const spec = join(root, "spec.json");
    await writeFile(spec, JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", spec, "--target", join(root, "acme")], a.io, ctx)).toBe(0);
    expect(a.out.join("")).toContain("plan_id: plan_");
    await expect(runProject(["plan", "--target", "x"], io().io, ctx)).rejects.toThrow(/Falta --spec/);
    await expect(runProject(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    const bad = io("{no json");
    await expect(runProject(["plan", "--spec", "-", "--target", join(root, "z")], bad.io, ctx)).rejects.toThrow(/JSON válido/);
  });

  test("un destino fuera de las raíces permitidas sale con código 1", async () => {
    const { ctx } = await setup();
    const a = io(JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", "-", "--target", "/etc/acme", "--json"], a.io, ctx)).toBe(1);
  });
});

describe("shardev ops (solo lectura, mismas funciones que las herramientas)", () => {
  afterEach(cleanup);
  const NOW = new Date("2026-11-01T12:00:00.000Z");
  const ev = [{ timestamp: Date.parse("2026-11-01T11:45:00Z"), message: "hola" }];

  async function opsSetup(accounts: Record<string, string | "expired"> = { "demo-stg": "111111111111" }) {
    const paths = await tempPaths();
    await registerDemoProject(paths, "", OPS_YAML_SERVICES());
    const runner = awsRunner(accounts, {
      "ecs describe-services": () => ({ services: [{ serviceName: "demo-staging-app", status: "ACTIVE", desiredCount: 1, runningCount: 1, pendingCount: 0, taskDefinition: "arn:x:task-definition/demo-staging-app:7" }], failures: [] }),
      "ecs list-tasks": () => ({ taskArns: [] }),
      "logs filter-log-events": cwLogs(ev),
    });
    return { paths, runner, ctx: createContext(paths, { runner, now: () => NOW }) };
  }

  test("services/tasks/logs --json devuelven el JSON de la herramienta; exit 0", async () => {
    const { ctx } = await opsSetup();
    const a = io();
    expect(await runOps(["services", "--project", "demo", "--env", "staging", "--json"], a.io, ctx)).toBe(0);
    expect(JSON.parse(a.out.join("")).services[0]).toMatchObject({ service: "demo-staging-app", task_definition: "demo-staging-app:7" });
    const b = io();
    expect(await runOps(["tasks", "--project", "demo", "--env", "staging", "--service", "demo-staging-app", "--status", "STOPPED", "--json"], b.io, ctx)).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ status: "STOPPED", tasks: [] });
    const c = io();
    expect(await runOps(["logs", "--project", "demo", "--env", "staging", "--service", "demo-staging-app", "--since-minutes", "30", "--filter", "ERR", "--limit", "10", "--json"], c.io, ctx)).toBe(0);
    const logs = JSON.parse(c.out.join(""));
    expect(logs).toMatchObject({ event_count: 1, since_minutes: 30, limit: 10 });
    expect(c.out.join("")).not.toContain("hola");
    expect(logs.log_ref).toMatch(/\.log$/);
  });

  test("salida humana, status, y exit 1 si falla (misma política: la auditoría la hace cada función)", async () => {
    const { ctx } = await opsSetup();
    const a = io();
    expect(await runOps(["services", "--project", "demo", "--env", "staging"], a.io, ctx)).toBe(0);
    expect(a.out.join("")).toContain("demo-staging-app  ACTIVE  1/1");
    const l = io();
    expect(await runOps(["logs", "--project", "demo", "--env", "staging", "--service", "demo-staging-app"], l.io, ctx)).toBe(0);
    expect(l.out.join("")).toContain("log_ref:");
    expect(l.out.join("")).not.toContain("hola");
    const s = io();
    expect(await runOps(["status", "--project", "demo", "--env", "staging"], s.io, ctx)).toBe(0);
    expect(JSON.parse(s.out.join("")).environments[0].env).toBe("staging");
    // servicio de otro entorno => exit 1, sin llamar a ECS
    const bad = io();
    expect(await runOps(["services", "--project", "demo", "--env", "staging", "--service", "demo-app"], bad.io, ctx)).toBe(1);
    expect(bad.out.join("")).toContain("no está declarado");
    // producción con perfil no listado => disabled => exit 1
    const prod = io();
    expect(await runOps(["services", "--project", "demo", "--env", "prod"], prod.io, ctx)).toBe(1);
  });

  test("errores de uso: --env obligatorio, valores numéricos y subcomando", async () => {
    const { ctx, runner } = await opsSetup();
    await expect(runOps(["services", "--project", "demo"], io().io, ctx)).rejects.toThrow(/Falta --env/);
    await expect(runOps(["tasks", "--project", "demo", "--env", "staging"], io().io, ctx)).rejects.toThrow(/Falta --service/);
    await expect(runOps(["logs", "--project", "demo", "--env", "staging", "--service", "demo-staging-app", "--limit", "abc"], io().io, ctx)).rejects.toThrow(/número entero/);
    await expect(runOps(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    const over = io();
    expect(await runOps(["logs", "--project", "demo", "--env", "staging", "--service", "demo-staging-app", "--limit", "5000"], over.io, ctx)).toBe(1);
    expect(runner.calls).toHaveLength(0);
  });

  describe("ops log-read", () => {
    async function withLog() {
      const s = await opsSetup();
      const l = await s.ctx.logs.write("demo", Array.from({ length: 30 }, (_, i) => `linea ${i + 1}${i === 9 ? " ERROR boom" : ""}`).join("\n"));
      return { ...s, ref: l.ref };
    }

    test("ref válido, grep y paginación; --json es exactamente el texto de la herramienta", async () => {
      const { ctx, ref } = await withLog();
      const a = io();
      expect(await runOps(["log-read", "--ref", ref, "--json"], a.io, ctx)).toBe(0);
      expect(a.out.join("")).toBe(`${(await logRead(ctx, { ref })).text}\n`);
      expect(a.out.join("")).toContain("<untrusted-data");
      expect(a.out.join("")).toContain("Contenido no confiable");

      const g = io();
      expect(await runOps(["log-read", "--ref", ref, "--grep", "error", "--context", "1", "--json"], g.io, ctx)).toBe(0);
      expect(g.out.join("")).toBe(`${(await logRead(ctx, { ref, grep: "error", context: 1 })).text}\n`);
      expect(g.out.join("")).toContain("10: linea 10 ERROR boom");
      expect(g.out.join("")).toContain("9: linea 9");

      const p = io();
      expect(await runOps(["log-read", "--ref", ref, "--offset", "5", "--limit", "3"], p.io, ctx)).toBe(0);
      expect(p.out.join("")).toBe(`${(await logRead(ctx, { ref, offset: 5, limit: 3 })).text}\n`);
      expect(p.out.join("")).toMatch(/5: .*\n6: .*\n7: /);
      expect(p.out.join("")).not.toContain("8: ");
    });

    test("ref inválida, traversal e inexistente: exit 1 con el mismo texto de la herramienta", async () => {
      const { ctx } = await withLog();
      for (const ref of ["../../etc/passwd", "/etc/passwd", "..", "no-es-un-ref.log", "x".repeat(131)]) {
        const o = io();
        expect(await runOps(["log-read", "--ref", ref], o.io, ctx)).toBe(1);
        if (ref.length <= 130) expect(o.out.join("")).toBe(`${(await logRead(ctx, { ref })).text}\n`);
      }
    });

    test("flags: --ref obligatorio, no enteros y fuera de rango rechazados", async () => {
      const { ctx, ref } = await withLog();
      await expect(runOps(["log-read"], io().io, ctx)).rejects.toThrow(/Falta --ref/);
      for (const f of ["limit", "offset", "context"]) {
        for (const v of ["abc", "1.5", "-1"]) await expect(runOps(["log-read", "--ref", ref, `--${f}`, v], io().io, ctx)).rejects.toThrow(/número entero/);
      }
      for (const [f, v] of [["limit", "0"], ["limit", "501"], ["context", "6"], ["offset", "0"]] as const) {
        const o = io();
        expect(await runOps(["log-read", "--ref", ref, `--${f}`, v], o.io, ctx)).toBe(1);
      }
    });
  });

  test("la ayuda documenta ops", () => {
    for (const w of ["ops status", "ops services", "ops tasks", "ops logs", "ops log-read", "--ref", "--grep", "--since-minutes", "--filter", "--limit"]) expect(USAGE).toContain(w);
  });
});

describe("shardev ops env-check", () => {
  afterEach(cleanup);

  test("--json imprime el JSON de la herramienta; falla con código 1 y no imprime valores; --env es obligatorio", async () => {
    const paths = await tempPaths();
    const dir = await registerDemoProject(paths, "", OPS_YAML_SERVICES());
    const ctx = createContext(paths);
    const a = io();
    expect(await runOps(["env-check", "--project", "demo", "--env", "staging", "--json"], a.io, ctx)).toBe(1); // sin .aws/env
    expect(JSON.parse(a.out.join(""))).toMatchObject({ project: "demo", env: "staging", ok: false });

    const envDir = join(dir, ".aws", "env", "staging");
    await mkdir(envDir, { recursive: true, mode: 0o700 });
    await write(join(envDir, "aws.env"), "AWS_PROFILE=demo-stg\n");
    await write(join(envDir, "environment.env"), "APP_NAME=cli-valor-distintivo\n");
    await writeFile(join(envDir, "secrets.env"), "APP_KEY=cli-secreto-distintivo\n", { mode: 0o600 });
    const b = io();
    expect(await runOps(["env-check", "--project", "demo", "--env", "staging"], b.io, ctx)).toBe(0);
    const text = b.out.join("");
    expect(text).toMatch(/^OK: demo\/staging/);
    expect(text).not.toContain("distintivo");
    await expect(runOps(["env-check", "--project", "demo"], io().io, ctx)).rejects.toThrow(/Falta --env/);
    expect(USAGE).toContain("ops env-check");
    expect(USAGE).toContain("ops ci-check");
    expect(USAGE).toContain("ops ci-generate");
  });
});
