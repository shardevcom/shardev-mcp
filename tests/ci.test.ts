import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { runOps, type CliIo } from "../src/cli-run.js";
import { exec, type Runner } from "../src/core/exec.js";
import { auditFile } from "../src/core/paths.js";
import { bodyFromName, parseSavedOptions, renderWorkflow } from "../src/ops/ci.js";
import { opsCiCheck, opsCiGenerate } from "../src/ops/ci.js";
import { createContext } from "../src/ops/context.js";
import { createServer } from "../src/server.js";
import { OPS_YAML, cleanup, tempDir, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

const TEMPLATE = `# Plantilla sintética de prueba
# Marcadores: @@ENVIRONMENT@@ (esta línea previa a name: se descarta)

name: "Deploy @@ENV_LABEL@@ (ECS@@MOBILE_LABEL@@)"

on:
@@TRIGGER@@

concurrency:
  group: deploy-@@ENVIRONMENT@@

jobs:
  web:
    runs-on: ubuntu-latest
    environment: @@ENVIRONMENT@@
    steps:
      - run: echo web
  # @@MOBILE_BEGIN@@
  mobile:
    runs-on: ubuntu-latest
    steps:
      - run: echo mobile
  # @@MOBILE_END@@
`;

function recordingRunner(): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((cmd, args, opts) => {
    calls.push([cmd, ...args]);
    return exec(cmd, args, opts);
  }) as Runner & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

async function setup(opts: { template?: string | null } = {}) {
  const paths = await tempPaths();
  const root = await tempDir();
  await write(join(root, "ops.yaml"), OPS_YAML());
  await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${root}\n`);
  if (opts.template !== null) {
    await mkdir(join(root, ".github", "templates"), { recursive: true });
    await write(join(root, ".github", "templates", "deploy.template.yml"), opts.template ?? TEMPLATE);
  }
  const runner = recordingRunner();
  const ctx = createContext(paths, { runner });
  const out = (env: string) => join(root, ".github", "workflows", `deploy-${env}.yml`);
  return { paths, root, runner, ctx, out };
}

const J = (o: { text: string }) => JSON.parse(o.text) as Record<string, any>;
const gen = (ctx: ReturnType<typeof createContext>, args: Record<string, unknown>) => opsCiGenerate(ctx, { project: "demo", ...args });
const chk = (ctx: ReturnType<typeof createContext>, args: Record<string, unknown>) => opsCiCheck(ctx, { project: "demo", ...args });

function io(): { io: CliIo; out: string[] } {
  const out: string[] = [];
  return { out, io: { out: (s) => out.push(s), err: () => undefined, stdin: async () => "" } };
}

describe("renderWorkflow: marcadores", () => {
  const base = { project: "demo", env: "staging" };
  test("cada marcador se sustituye, la cabecera de la plantilla se descarta y el resultado es YAML", () => {
    const t = renderWorkflow(TEMPLATE, { ...base, branch: "develop", mobile: true });
    expect(t).toContain('name: "Deploy Staging (ECS + Mobile)"'); // ENV_LABEL y MOBILE_LABEL
    expect(t).toContain("group: deploy-staging"); // ENVIRONMENT
    expect(t).toContain("    environment: staging");
    expect(t).toContain("on:\n  push:\n    branches: [develop]\n  workflow_dispatch:"); // TRIGGER
    expect(t).not.toContain("Plantilla sintética");
    expect(t).not.toContain("@@");
    expect(t).toMatch(/^# Opciones: --branch=develop --mobile$/m);
    expect(t).toContain("NO EDITAR A MANO");
  });
  test("sin rama: solo workflow_dispatch y un comentario con el comando", () => {
    const t = renderWorkflow(TEMPLATE, { ...base, branch: undefined, mobile: false });
    expect(t).not.toContain("branches:");
    expect(t).toContain("  workflow_dispatch:");
    expect(t).toContain("--branch '<rama>'");
    expect(t).toMatch(/^# Opciones: --no-mobile$/m);
  });
  test("móvil conservado (sin marcadores) y eliminado", () => {
    const on = renderWorkflow(TEMPLATE, { ...base, branch: undefined, mobile: true });
    expect(on).toContain("  mobile:");
    expect(on).not.toContain("MOBILE_");
    const off = renderWorkflow(TEMPLATE, { ...base, branch: undefined, mobile: false });
    expect(off).not.toContain("mobile:");
    expect(off).not.toContain("echo mobile");
    expect(off).toContain('name: "Deploy Staging (ECS)"');
  });
  test("marcador sin reemplazar o BEGIN sin END se rechazan", () => {
    expect(() => renderWorkflow(`${TEMPLATE}# @@DESCONOCIDO@@\n`, { ...base, branch: undefined, mobile: false })).toThrow(/sin reemplazar/);
    expect(() => renderWorkflow(TEMPLATE.replace("  # @@MOBILE_END@@\n", ""), { ...base, branch: undefined, mobile: false })).toThrow(/sin su @@MOBILE_END@@/);
    expect(() => renderWorkflow("jobs: {}\n", { ...base, branch: undefined, mobile: false })).toThrow(/name:/);
  });
  test("YAML inválido se rechaza", () => {
    expect(() => renderWorkflow(`${TEMPLATE}  - clave: [sin cerrar\n`, { ...base, branch: undefined, mobile: false })).toThrow(/YAML/);
  });
  test("parseSavedOptions y bodyFromName", () => {
    expect(parseSavedOptions("# x\n# Opciones: --branch=a/b --no-mobile\n")).toEqual({ branch: "a/b", mobile: false });
    expect(parseSavedOptions("name: x\n")).toEqual({});
    expect(bodyFromName("# h1\n# h2\nname: x\non: y\n")).toBe("name: x\non: y\n");
  });
});

describe("ops_ci_generate / ops_ci_check", () => {
  test("rama inválida, producción sin rama, master en no producción", async () => {
    const { ctx, out } = await setup();
    for (const branch of ["a b", "x;rm", "a$b", "../..\n"]) {
      const o = await gen(ctx, { env: "staging", branch });
      expect(o, branch).toMatchObject({ isError: true, decision: "rejected" });
      expect(o.text).toMatch(/inválida/);
    }
    const p = await gen(ctx, { env: "prod" });
    expect(p).toMatchObject({ isError: true, decision: "rejected" });
    expect(p.text).toMatch(/producción/);
    expect((await chk(ctx, { env: "prod" })).isError).toBe(true);
    for (const branch of ["master", "main"]) {
      const m = await gen(ctx, { env: "staging", branch });
      expect(m).toMatchObject({ isError: true, decision: "rejected" });
      expect(m.text).toMatch(/despliega producción/);
    }
    await expect(stat(out("staging"))).rejects.toThrow();
  });

  test("no producción: escribe, mobile por defecto false; luego up_to_date; explícito sobrescribe lo guardado", async () => {
    const { ctx, out, runner } = await setup();
    const o = await gen(ctx, { env: "staging", branch: "develop" });
    expect(o.isError).toBe(false);
    expect(J(o)).toMatchObject({ written: true, previous: "missing", options: { branch: "develop", mobile: false, origin: "flags" } });
    expect(J(o).message).toMatch(/commit/);
    const text = await readFile(out("staging"), "utf8");
    expect(text).toContain("branches: [develop]");
    expect(text).not.toContain("mobile:");
    expect(((await stat(out("staging"))).mode & 0o777).toString(8)).toBe("644");

    const c = await chk(ctx, { env: "staging" });
    expect(J(c)).toMatchObject({ status: "up_to_date", options: { branch: "develop", mobile: false, origin: "saved" } });
    expect(c.isError).toBe(false);

    // Opciones guardadas reutilizadas al regenerar sin flags.
    expect(J(await gen(ctx, { env: "staging" }))).toMatchObject({ written: false, previous: "up_to_date" });

    // Explícito gana sobre lo guardado.
    const d = await chk(ctx, { env: "staging", branch: "qa", mobile: true });
    expect(J(d)).toMatchObject({ status: "different", options: { branch: "qa", mobile: true, origin: "flags" } });
    expect(J(d).differing_lines).toBeGreaterThan(0);
    expect(d.isError).toBe(true);
    await gen(ctx, { env: "staging", mobile: true }); // mobile explícito, sin rama => se pierde la rama (como el script)
    const t2 = await readFile(out("staging"), "utf8");
    expect(t2).toContain("  mobile:");
    expect(t2).not.toContain("branches:");
    // Solo se tocó el archivo de salida: ni temporales.
    expect(await readdir(join(out("staging"), ".."))).toEqual(["deploy-staging.yml"]);
    expect(runner.calls.filter((c) => c[0] === "aws")).toEqual([]);
  });

  test("diferencias solo de cabecera cuentan como al día; diferencia de cuerpo y archivo ausente se reportan", async () => {
    const { ctx, out, root } = await setup();
    expect(J(await chk(ctx, { env: "staging", branch: "develop" })).status).toBe("missing");
    await gen(ctx, { env: "staging", branch: "develop" });
    const original = await readFile(out("staging"), "utf8");

    // Cabecera de otra herramienta (con su propia línea de opciones) y mismo cuerpo.
    const foreign = `# otro generador, otro texto\n# Opciones: --branch=develop --no-mobile\n${original.slice(original.indexOf("name:"))}`;
    await writeFile(out("staging"), foreign);
    const a = await chk(ctx, { env: "staging" });
    expect(J(a)).toMatchObject({ status: "up_to_date", differing_lines: 0, options: { origin: "saved" } });
    expect(a.isError).toBe(false);
    // Sin línea de opciones y con flags explícitos también coincide.
    await writeFile(out("staging"), `# sin opciones\n${original.slice(original.indexOf("name:"))}`);
    expect(J(await chk(ctx, { env: "staging", branch: "develop", mobile: false })).status).toBe("up_to_date");

    // Diferencia de cuerpo.
    await writeFile(out("staging"), original.replace("echo web", "echo OTRA COSA"));
    const b = await chk(ctx, { env: "staging" });
    expect(b.isError).toBe(true);
    const bj = J(b);
    expect(bj).toMatchObject({ status: "different", differing_lines: 2 });
    expect(bj.diff).toContain("-      - run: echo OTRA COSA");
    expect(bj.diff).toContain("+      - run: echo web");
    expect(bj.message).toContain("shardev ops ci-generate");

    // Diff acotado.
    const big = original.replace("      - run: echo web", Array.from({ length: 400 }, (_, i) => `      - run: echo ${i}`).join("\n"));
    const cj = J(await chk(ctx, { env: "staging" }).then(() => writeFile(out("staging"), big)).then(() => chk(ctx, { env: "staging" })));
    expect(cj.diff_truncated).toBe(true);
    expect(cj.diff.split("\n").length).toBeLessThanOrEqual(120);
    expect(cj.differing_lines).toBeGreaterThan(300);
    void root;
  });

  test("ci-check no escribe nada (ni crea .github/workflows)", async () => {
    const { ctx, root, paths } = await setup();
    const before = await readdir(root, { recursive: true });
    expect((await chk(ctx, { env: "staging", branch: "develop" })).isError).toBe(true);
    expect(await readdir(root, { recursive: true })).toEqual(before);
    expect(await readdir(paths.configDir)).toEqual(["projects.yaml"]);
  });

  test("producción: el MCP nunca escribe y devuelve el comando exacto; la CLI sí escribe (mobile por defecto true)", async () => {
    const { ctx, root, out } = await setup();
    const o = await gen(ctx, { env: "prod", branch: "release" });
    expect(o).toMatchObject({ isError: false, decision: "command-only" });
    const j = J(o);
    expect(j).toMatchObject({ written: false, decision: "command-only", command: "shardev ops ci-generate --project demo --env prod --branch release --mobile" });
    expect(j.message).toMatch(/NO se escribió nada/);
    await expect(stat(out("prod"))).rejects.toThrow();
    await expect(stat(join(root, ".github", "workflows"))).rejects.toThrow();

    const a = io();
    expect(await runOps(["ci-generate", "--project", "demo", "--env", "prod", "--branch=release"], a.io, ctx)).toBe(0);
    const text = await readFile(out("prod"), "utf8");
    expect(text).toContain("branches: [release]");
    expect(text).toContain("  mobile:");
    expect(text).toContain('name: "Deploy Prod (ECS + Mobile)"');
    expect(a.out.join("")).toMatch(/Se escribió/);
    expect(a.out.join("")).toMatch(/commit/);

    // Ahora el MCP en producción informa el estado pero sigue sin escribir.
    const again = J(await gen(ctx, { env: "prod" })); // opciones guardadas
    expect(again).toMatchObject({ decision: "command-only", written: false, previous: "up_to_date", options: { branch: "release", mobile: true, origin: "saved" } });
    // Producción por CLI sin rama sigue rechazada.
    const b = io();
    await expect(runOps(["ci-generate", "--project", "demo", "--env", "prod", "--no-mobile", "--mobile"], b.io, ctx)).rejects.toThrow(/excluyentes/);
    expect(await runOps(["ci-generate", "--project", "demo", "--env", "prod", "--mobile"], b.io, ctx)).toBe(1); // flags explícitas sin rama: no reutiliza lo guardado
  });

  test("enlaces simbólicos en salida, plantilla o directorios, y escape de la raíz, se rechazan", async () => {
    const { ctx, root, out } = await setup();
    const outside = await tempDir();

    // Salida enlazada.
    await mkdir(join(root, ".github", "workflows"), { recursive: true });
    await write(join(outside, "victima.yml"), "name: intacto\n");
    await symlink(join(outside, "victima.yml"), out("staging"));
    for (const fn of [gen, chk]) {
      const o = await fn(ctx, { env: "staging", branch: "develop" });
      expect(o).toMatchObject({ isError: true, decision: "rejected" });
      expect(o.text).toMatch(/enlace simbólico/);
    }
    expect(await readFile(join(outside, "victima.yml"), "utf8")).toBe("name: intacto\n");

    // Directorio de workflows enlazado fuera de la raíz.
    const { ctx: c2, root: r2 } = await setup();
    await mkdir(join(r2, ".github"), { recursive: true });
    await symlink(outside, join(r2, ".github", "workflows"));
    const o2 = await gen(c2, { env: "staging", branch: "develop" });
    expect(o2).toMatchObject({ isError: true, decision: "rejected" });
    expect(await readdir(outside)).toEqual(["victima.yml"]);

    // Plantilla enlazada.
    const { ctx: c3, root: r3 } = await setup({ template: null });
    await mkdir(join(r3, ".github", "templates"), { recursive: true });
    await write(join(outside, "t.yml"), TEMPLATE);
    await symlink(join(outside, "t.yml"), join(r3, ".github", "templates", "deploy.template.yml"));
    const o3 = await gen(c3, { env: "staging", branch: "develop" });
    expect(o3).toMatchObject({ isError: true, decision: "rejected" });
    expect(o3.text).toMatch(/enlace simbólico/);
    await expect(stat(join(r3, ".github", "workflows"))).rejects.toThrow();

    // Nombre de entorno que intenta salir de la raíz.
    for (const env of ["../../x", "a/b", "Staging", "x"]) {
      const o = await gen(ctx, { env, branch: "develop" });
      expect(o, env).toMatchObject({ isError: true, decision: "rejected" });
    }
    expect(await readdir(outside)).toEqual(expect.arrayContaining(["victima.yml"]));
  });

  test("plantilla ausente: error claro", async () => {
    const { ctx } = await setup({ template: null });
    const o = await gen(ctx, { env: "staging", branch: "develop" });
    expect(o).toMatchObject({ isError: true, decision: "rejected" });
    expect(o.text).toMatch(/No existe la plantilla \.github\/templates\/deploy\.template\.yml/);
  });
});

describe("MCP y CLI", () => {
  test("ops_ci_generate por MCP: no producción escribe, producción no; auditoría sin datos extra", async () => {
    const { paths, root, out, runner } = await setup();
    const { server } = createServer({ paths, runner });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };

    const r = await call("ops_ci_generate", { project: "demo", env: "staging", branch: "develop" });
    expect(r.isError).toBeUndefined();
    expect(JSON.parse(r.content[0]!.text)).toMatchObject({ written: true });
    expect(await readFile(out("staging"), "utf8")).toContain("branches: [develop]");

    const p = await call("ops_ci_generate", { project: "demo", env: "prod", branch: "release" });
    expect(JSON.parse(p.content[0]!.text)).toMatchObject({ decision: "command-only", written: false });
    await expect(stat(out("prod"))).rejects.toThrow();

    const c = await call("ops_ci_check", { project: "demo", env: "staging" });
    expect(c.isError).toBeUndefined();
    const d = await call("ops_ci_check", { project: "demo", env: "prod", branch: "release" });
    expect(d.isError).toBe(true);
    expect(JSON.parse(d.content[0]!.text).status).toBe("missing");

    const audit = await readFile(auditFile(paths), "utf8");
    expect(audit).toContain("ops_ci_generate");
    expect(audit).toContain('"command-only"');
    expect(runner.calls.filter((x) => x[0] === "aws")).toEqual([]);
    void root;
  });

  test("CLI ci-check: código de salida, salida humana y --json; ci-generate en no producción", async () => {
    const { ctx, out } = await setup();
    const a = io();
    expect(await runOps(["ci-check", "--project", "demo", "--env", "staging", "--branch", "develop"], a.io, ctx)).toBe(1);
    expect(a.out.join("")).toMatch(/no existe/);
    const b = io();
    expect(await runOps(["ci-generate", "--project", "demo", "--env", "staging", "--branch", "develop", "--json"], b.io, ctx)).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ written: true });
    const c = io();
    expect(await runOps(["ci-check", "--project", "demo", "--env", "staging"], c.io, ctx)).toBe(0);
    expect(c.out.join("")).toMatch(/al día/);
    await writeFile(out("staging"), (await readFile(out("staging"), "utf8")).replace("echo web", "echo X"));
    const d = io();
    expect(await runOps(["ci-check", "--project", "demo", "--env", "staging"], d.io, ctx)).toBe(1);
    expect(d.out.join("")).toMatch(/líneas distintas: 2/);
    const e = io();
    expect(await runOps(["ci-generate", "--project", "demo", "--env", "staging", "--branch", "master"], e.io, ctx)).toBe(1);
    await expect(runOps(["ci-check", "--project", "demo"], io().io, ctx)).rejects.toThrow(/Falta --env/);
  });
});
