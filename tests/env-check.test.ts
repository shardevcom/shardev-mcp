import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { parseEnvFile, parseSchema } from "../src/core/env-file.js";
import { exec, type Runner } from "../src/core/exec.js";
import { loadRegistry } from "../src/core/manifest.js";
import { auditFile } from "../src/core/paths.js";
import { createContext } from "../src/ops/context.js";
import { opsEnvCheck, type Check } from "../src/ops/env-check.js";
import { createServer } from "../src/server.js";
import { OPS_YAML_SERVICES, cleanup, tempDir, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

interface Result {
  project: string;
  env: string;
  ok: boolean;
  checks: Check[];
  counts: { ok: number; warn: number; fail: number; skip: number };
}

/** Runner que delega en el real y registra las llamadas: ningún test debe llegar a `aws`. */
function recordingRunner(): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = ((cmd, args, opts) => {
    calls.push([cmd, ...args]);
    return exec(cmd, args, opts);
  }) as Runner & { calls: string[][] };
  fn.calls = calls;
  return fn;
}

const STAGING_AWS = "AWS_PROFILE=demo-stg\nAWS_ACCOUNT_ID=111111111111\nAWS_ECS_CLUSTER_NAME=shared\nAWS_DEFAULT_REGION=us-east-1\nAWS_PROJECT_NAME=demo-staging\nAWS_DOMAIN_NAME=staging.demo.test\n";
const STAGING_ENV = "# configuración\nexport APP_NAME=demo\nDB_DATABASE=demo_staging\nDB_USERNAME=demo_stg\nREDIS_HOST=redis-stg\nPUBLIC_ID=pub-1\n";
const STAGING_SECRETS = "APP_KEY=k-staging\nDB_PASSWORD=p-staging\n";
const PROD_AWS = "AWS_PROJECT_NAME=demo\nAWS_DOMAIN_NAME=demo.test\n";
const PROD_ENV = "DB_DATABASE=demo_prod\nDB_USERNAME=demo_prd\nREDIS_HOST=redis-prd\n";
const SCHEMA = "# clasificación\nsecret APP_KEY required\nsecret DB_PASSWORD\npublic PUBLIC_ID\npublic APP_NAME\nexclude LOCAL_TOOL\n";

interface Files {
  aws?: string | null;
  environment?: string | null;
  secrets?: string | null;
}

async function writeEnv(root: string, env: string, f: Files, secretsMode = 0o600): Promise<string> {
  const dir = join(root, ".aws", "env", env);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const kind of ["aws", "environment", "secrets"] as const) {
    const text = f[kind];
    if (text === null) continue;
    await writeFile(join(dir, `${kind}.env`), text ?? "", { mode: kind === "secrets" ? secretsMode : 0o644 });
  }
  return dir;
}

/** Proyecto `demo` con staging completo y válido. `root` separado opcional. */
async function setup(opts: { separateRoot?: boolean; policy?: string; production?: boolean; schema?: string | null } = {}) {
  const paths = await tempPaths();
  const path = await tempDir();
  const root = opts.separateRoot ? await tempDir() : path;
  await write(join(path, "ops.yaml"), OPS_YAML_SERVICES());
  await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${path}\n${opts.separateRoot ? `    root: ${root}\n` : ""}`);
  if (opts.policy) await write(join(paths.configDir, "policy.yaml"), opts.policy);
  await writeEnv(root, "staging", { aws: STAGING_AWS, environment: STAGING_ENV, secrets: STAGING_SECRETS });
  if (opts.production !== false) await writeEnv(root, "prod", { aws: PROD_AWS, environment: PROD_ENV, secrets: "APP_KEY=k-prod\n" });
  if (opts.schema !== null) await write(join(root, "env.schema"), opts.schema ?? SCHEMA);
  const runner = recordingRunner();
  const ctx = createContext(paths, { runner });
  return { paths, path, root, runner, ctx };
}

async function check(ctx: ReturnType<typeof createContext>, env = "staging"): Promise<Result & { isError: boolean }> {
  const o = await opsEnvCheck(ctx, { project: "demo", env });
  return { ...(JSON.parse(o.text) as Result), isError: o.isError };
}
const byName = (r: Result, name: string): Check => r.checks.find((c) => c.name === name)!;

function gitInit(root: string, track?: string): void {
  execFileSync("git", ["init", "-q", root]);
  if (track) execFileSync("git", ["-C", root, "add", "-f", "--", track]);
}

describe("ops_env_check: camino feliz", () => {
  test("entorno válido: ok, sin fallos, solo se llama a git (nunca a aws)", async () => {
    const { ctx, root, runner } = await setup();
    gitInit(root);
    const r = await check(ctx);
    expect(r).toMatchObject({ project: "demo", env: "staging", ok: true, isError: false });
    expect(r.counts.fail).toBe(0);
    expect(r.counts.ok + r.counts.warn + r.counts.skip).toBe(r.checks.length);
    for (const name of ["clasificacion", "manifiesto", "politica", "archivos", "permisos", "git", "sintaxis", "esquema", "aislamiento", "consistencia"]) {
      expect(byName(r, name).status, name).toBe("ok");
    }
    expect(runner.calls.length).toBeGreaterThan(0);
    expect(runner.calls.every((c) => c[0] === "git")).toBe(true);
  });

  test("los avisos no hacen fallar: sin repositorio git y sin env.schema son warn y ok sigue en true", async () => {
    const { ctx } = await setup({ schema: null });
    const r = await check(ctx);
    expect(r.ok).toBe(true);
    expect(byName(r, "git").status).toBe("warn");
    expect(byName(r, "esquema").status).toBe("warn");
  });

  test("`root` separado de `path`: los archivos se buscan en root; sin root se usa path", async () => {
    const sep = await setup({ separateRoot: true });
    expect((await check(sep.ctx)).ok).toBe(true);
    const reg = await loadRegistry(sep.paths);
    expect(reg.projects.demo).toMatchObject({ path: sep.path, root: sep.root });

    // Sin archivos en `path` (y root declarado): el entorno se busca en root, no en path.
    const plain = await setup();
    const reg2 = await loadRegistry(plain.paths);
    expect(reg2.projects.demo!.root).toBeUndefined();
    expect((await check(plain.ctx)).ok).toBe(true);
  });

  test("`root` relativo se rechaza; claves desconocidas siguen siendo inválidas", async () => {
    const { ctx, paths, path } = await setup();
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${path}\n    root: relativo/dir\n`);
    const o = await opsEnvCheck(ctx, { project: "demo", env: "staging" });
    expect(o).toMatchObject({ isError: true, decision: "rejected" });
    expect(o.text).toMatch(/root.*absoluta/);
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${path}\n    otra: 1\n`);
    expect((await opsEnvCheck(ctx, { project: "demo", env: "staging" })).isError).toBe(true);
  });

  test("env omitido, entorno desconocido y proyecto ausente se rechazan antes de mirar archivos", async () => {
    const { ctx } = await setup();
    expect(await opsEnvCheck(ctx, { project: "demo" })).toMatchObject({ isError: true, decision: "rejected" });
    expect((await opsEnvCheck(ctx, { project: "demo", env: "" })).text).toMatch(/entorno explícitamente/);
    expect((await opsEnvCheck(ctx, { project: "demo", env: "nope" })).text).toMatch(/no existe/);
    expect((await opsEnvCheck(ctx, { env: "staging" })).text).toMatch(/project/);
    expect((await opsEnvCheck(ctx, { project: "otro", env: "staging" })).text).toMatch(/no está registrado/);
  });
});

describe("ops_env_check: manifest y política", () => {
  test("producción sin regla aws_profiles falla; con regla pasa", async () => {
    const a = await setup();
    const r = await check(a.ctx, "prod");
    expect(r.ok).toBe(false);
    expect(byName(r, "politica")).toMatchObject({ status: "fail" });
    expect(byName(r, "aislamiento").status).toBe("skip");

    const b = await setup({ policy: 'aws_profiles:\n  demo-prod:\n    account_id: "222222222222"\n    production_mode: command-only\n' });
    expect(byName(await check(b.ctx, "prod"), "politica").status).toBe("ok");
  });

  test("conflicto de clasificación (production_envs) avisa y trata el entorno como producción", async () => {
    const { ctx, paths, path } = await setup();
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${path}\n    production_envs: [staging]\n`);
    const r = await check(ctx);
    expect(byName(r, "clasificacion").status).toBe("warn");
    expect(byName(r, "politica").status).toBe("fail");
  });

  test("sin `services` o sin `capabilities` falla el check del manifiesto", async () => {
    const { ctx, path } = await setup();
    await write(join(path, "ops.yaml"), OPS_YAML_SERVICES().replace(/    services: \[demo-staging-app, demo-staging-worker\]\n/, ""));
    expect(byName(await check(ctx), "manifiesto")).toMatchObject({ status: "fail" });
    await write(join(path, "ops.yaml"), OPS_YAML_SERVICES("[]"));
    expect(byName(await check(ctx), "manifiesto").message).toMatch(/capabilities/);
  });

  test("policy.yaml inválido falla el check de política", async () => {
    const { ctx } = await setup({ policy: "aws_profiles: 3\n" });
    expect(byName(await check(ctx), "politica").status).toBe("fail");
  });
});

describe("ops_env_check: disposición de archivos", () => {
  test("falta el directorio del entorno: fallo claro y el resto se omite", async () => {
    const { ctx, root } = await setup();
    await rm(join(root, ".aws", "env", "staging"), { recursive: true });
    const r = await check(ctx);
    expect(r).toMatchObject({ ok: false, isError: true });
    expect(byName(r, "archivos").message).toContain(".aws/env/staging/");
    expect(r.checks.filter((c) => c.status === "skip").map((c) => c.name)).toEqual(expect.arrayContaining(["sintaxis", "esquema", "aislamiento", "consistencia"]));
  });

  test("falta un archivo: fallo", async () => {
    const { ctx, root } = await setup();
    await rm(join(root, ".aws", "env", "staging", "environment.env"));
    const r = await check(ctx);
    expect(byName(r, "archivos")).toMatchObject({ status: "fail" });
    expect(byName(r, "archivos").message).toContain("environment.env no existe");
  });

  test("un archivo que es enlace simbólico se rechaza (aunque apunte dentro de la raíz)", async () => {
    const { ctx, root } = await setup();
    const dir = join(root, ".aws", "env", "staging");
    await write(join(root, "real.env"), "APP_NAME=x\n");
    await rm(join(dir, "environment.env"));
    await symlink(join(root, "real.env"), join(dir, "environment.env"));
    const r = await check(ctx);
    expect(byName(r, "archivos").status).toBe("fail");
    expect(byName(r, "archivos").message).toContain("enlace simbólico");
  });

  test("un enlace a un archivo fuera de la raíz se rechaza", async () => {
    const { ctx, root } = await setup();
    const outside = await tempDir();
    await write(join(outside, "x.env"), "APP_NAME=x\n");
    const dir = join(root, ".aws", "env", "staging");
    await rm(join(dir, "aws.env"));
    await symlink(join(outside, "x.env"), join(dir, "aws.env"));
    expect(byName(await check(ctx), "archivos").status).toBe("fail");
  });

  test("un directorio de entorno que apunta fuera de la raíz se rechaza", async () => {
    const { ctx, root } = await setup();
    const outside = await tempDir();
    for (const k of ["aws", "environment", "secrets"]) await write(join(outside, `${k}.env`), "A=1\n");
    await rm(join(root, ".aws", "env", "staging"), { recursive: true });
    await symlink(outside, join(root, ".aws", "env", "staging"));
    const r = await check(ctx);
    expect(byName(r, "archivos").status).toBe("fail");
    expect(byName(r, "archivos").message).toMatch(/enlace simbólico|fuera de la raíz/);
    expect(byName(r, "sintaxis").status).toBe("skip");
  });

  test(".aws enlazado a un directorio externo (la ruta real sale de la raíz) se rechaza", async () => {
    const { ctx, root } = await setup();
    const outside = await tempDir();
    await rename(join(root, ".aws"), join(outside, "aws"));
    await symlink(join(outside, "aws"), join(root, ".aws"));
    const r = await check(ctx);
    expect(byName(r, "archivos")).toMatchObject({ status: "fail" });
    expect(byName(r, "archivos").message).toContain("fuera de la raíz");
  });

  test("secrets.env legible por grupo u otros avisa", async () => {
    const { ctx, root } = await setup();
    await chmod(join(root, ".aws", "env", "staging", "secrets.env"), 0o644);
    const r = await check(ctx);
    expect(byName(r, "permisos").status).toBe("warn");
    expect(r.ok).toBe(true);
  });

  test("secrets.env versionado en git falla; sin versionar, pasa", async () => {
    const { ctx, root } = await setup();
    gitInit(root, ".aws/env/staging/secrets.env");
    const tracked = await check(ctx);
    expect(byName(tracked, "git")).toMatchObject({ status: "fail" });
    expect(tracked.ok).toBe(false);
    execFileSync("git", ["-C", root, "rm", "-q", "--cached", "--", ".aws/env/staging/secrets.env"]);
    expect(byName(await check(ctx), "git").status).toBe("ok");
  });
});

describe("ops_env_check: sintaxis y esquema", () => {
  test("duplicados, nombres inválidos, líneas sin '=' y comillas sin cerrar fallan, sin reproducir el texto", async () => {
    const { ctx, root } = await setup();
    const dir = join(root, ".aws", "env", "staging");
    await write(join(dir, "environment.env"), "DUP=uno-valor-zzz\nDUP=dos-valor-zzz\nminuscula=valor-zzz\nlinea-suelta-zzz\n");
    const r = await check(ctx);
    const msg = byName(r, "sintaxis").message;
    expect(byName(r, "sintaxis").status).toBe("fail");
    expect(msg).toContain("DUP");
    expect(msg).toMatch(/línea/);
    expect(msg).not.toContain("zzz");
    expect(msg).not.toContain("minuscula");

    await write(join(dir, "environment.env"), 'KEY="sin cerrar-zzz\nsegunda-zzz\n');
    const u = byName(await check(ctx), "sintaxis");
    expect(u.status).toBe("fail");
    expect(u.message).toContain("comilla sin cerrar");
    expect(u.message).not.toContain("zzz");
  });

  test("env.schema: secret fuera de secrets.env, obligatoria ausente o vacía fallan; vacía opcional avisa", async () => {
    const { ctx, root } = await setup();
    const dir = join(root, ".aws", "env", "staging");
    await write(join(dir, "environment.env"), `${STAGING_ENV}DB_PASSWORD=en-lugar-equivocado\n`);
    let e = byName(await check(ctx), "esquema");
    expect(e.status).toBe("fail");
    expect(e.message).toContain("DB_PASSWORD es secret y está en environment.env");
    expect(e.message).not.toContain("equivocado");

    await write(join(dir, "environment.env"), STAGING_ENV);
    await writeFile(join(dir, "secrets.env"), "DB_PASSWORD=\n", { mode: 0o600 });
    e = byName(await check(ctx), "esquema");
    expect(e.status).toBe("fail");
    expect(e.message).toContain("APP_KEY es obligatoria y no está definida");
    expect(e.message).toContain("DB_PASSWORD está vacía"); // opcional: aviso dentro del mismo mensaje

    await writeFile(join(dir, "secrets.env"), "APP_KEY=\nDB_PASSWORD=x\n", { mode: 0o600 });
    expect(byName(await check(ctx), "esquema").message).toContain("APP_KEY es obligatoria y está vacía");

    await writeFile(join(dir, "secrets.env"), "APP_KEY=k\nPUBLIC_ID=p\n", { mode: 0o600 });
    await write(join(dir, "environment.env"), "APP_NAME=a\n");
    const w = byName(await check(ctx), "esquema");
    expect(w.status).toBe("warn");
    expect(w.message).toContain("PUBLIC_ID es public y está en secrets.env");
  });

  test("env.schema inválido o enlace simbólico falla; VITE_ en secrets.env falla", async () => {
    const { ctx, root } = await setup({ schema: "secreto APP_KEY\nsecret VITE_X\npublic bad-name\n" });
    const e = byName(await check(ctx), "esquema");
    expect(e.status).toBe("fail");
    expect(e.message).toMatch(/categoría desconocida/);
    expect(e.message).toMatch(/VITE_/);

    await write(join(root, "env.schema"), SCHEMA);
    await writeFile(join(root, ".aws", "env", "staging", "secrets.env"), "APP_KEY=k\nVITE_TOKEN=t\n", { mode: 0o600 });
    expect(byName(await check(ctx), "esquema").message).toContain("VITE_TOKEN (VITE_) está en secrets.env");

    await rm(join(root, "env.schema"));
    await write(join(root, "otro.schema"), SCHEMA);
    await symlink(join(root, "otro.schema"), join(root, "env.schema"));
    expect(byName(await check(ctx), "esquema")).toMatchObject({ status: "fail" });
  });

  test("el parser de env.schema acepta el formato real (comentarios, categorías, espacios)", () => {
    const p = parseSchema("# c\n\nsecret  APP_KEY\npublic  APP_ID # al final\nexclude LOCAL\n");
    expect(p.errors).toEqual([]);
    expect(p.entries.map((e) => `${e.category}:${e.name}:${e.required}`)).toEqual(["secret:APP_KEY:false", "public:APP_ID:false", "exclude:LOCAL:false"]);
  });
});

describe("ops_env_check: aislamiento y consistencia", () => {
  test("variable igual a producción falla (solo el nombre); ausente en un lado avisa", async () => {
    const { ctx, root } = await setup();
    const dir = join(root, ".aws", "env", "staging");
    await write(join(dir, "environment.env"), STAGING_ENV.replace("DB_DATABASE=demo_staging", "DB_DATABASE=demo_prod"));
    const r = await check(ctx);
    const a = byName(r, "aislamiento");
    expect(a.status).toBe("fail");
    expect(a.message).toContain("DB_DATABASE: igual a producción");
    expect(a.message).not.toContain("demo_prod");

    await write(join(dir, "environment.env"), STAGING_ENV.replace(/REDIS_HOST=.*\n/, ""));
    const w = byName(await check(ctx), "aislamiento");
    expect(w.status).toBe("warn");
    expect(w.message).toContain("REDIS_HOST");
  });

  test("sin configuración de producción el aislamiento se omite; también se usa el directorio `production`", async () => {
    const a = await setup({ production: false });
    expect(byName(await check(a.ctx), "aislamiento").status).toBe("skip");
    await writeEnv(a.root, "production", { aws: STAGING_AWS, environment: STAGING_ENV, secrets: "" });
    expect(byName(await check(a.ctx), "aislamiento").status).toBe("fail");
  });

  test("AWS_PROFILE, AWS_ACCOUNT_ID, AWS_ECS_CLUSTER_NAME y región deben coincidir con ops.yaml", async () => {
    const { ctx, root } = await setup();
    const aws = join(root, ".aws", "env", "staging", "aws.env");
    await write(aws, STAGING_AWS.replace("111111111111", "999999999999").replace("AWS_DEFAULT_REGION=us-east-1", "AWS_REGION=eu-west-1"));
    const c = byName(await check(ctx), "consistencia");
    expect(c.status).toBe("fail");
    expect(c.message).toContain("AWS_ACCOUNT_ID");
    expect(c.message).toContain("AWS_REGION");
    expect(c.message).not.toContain("999999999999");
    expect(c.message).not.toContain("eu-west-1");

    await write(aws, "AWS_PROJECT_NAME=x\n");
    expect(byName(await check(ctx), "consistencia").status).toBe("skip");
  });
});

describe("parser de archivos de variables", () => {
  test("export, comentarios, comillas, vacíos y varias líneas (PEM) sin guardar valores", () => {
    const f = parseEnvFile('# c\nexport A=1\nB="dos # no es comentario"\nC=\nD=\'\'\nE=x # sí\nF="-----BEGIN\nlinea\n-----END"\nG=ok\r\n');
    expect([...f.vars.keys()]).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(f.vars.get("C")!.nonEmpty).toBe(false);
    expect(f.vars.get("D")!.nonEmpty).toBe(false);
    expect(f.vars.get("F")!.nonEmpty).toBe(true);
    expect(f.malformedLines).toEqual([]);
    expect(JSON.stringify([...f.vars.values()])).not.toContain("BEGIN");
  });
});

describe("ops_env_check: nunca devuelve ni registra valores (ruta MCP)", () => {
  test("valores distintivos en todos los archivos no aparecen en la respuesta ni en la auditoría, tampoco con errores de parseo", async () => {
    const { paths, root } = await setup({ production: true });
    const dir = join(root, ".aws", "env", "staging");
    const planted = ["VALOR-AWS-7f3a", "VALOR-ENV-91bc", "VALOR-SEC-c04d", "VALOR-MALO-55ee", "VALOR-PEM-aa12", "VALOR-NOMBRE-3333", "VALOR-DUP-zz99", "VALOR-PROD-8c8c"];
    await write(join(dir, "aws.env"), `${STAGING_AWS}AWS_PROFILE=VALOR-AWS-7f3a\nAWS_ACCOUNT_ID=VALOR-AWS-7f3a\nAWS_REGION=VALOR-AWS-7f3a\n`);
    await write(
      join(dir, "environment.env"),
      `${STAGING_ENV}DB_DATABASE=VALOR-PROD-8c8c\nDB_PASSWORD=VALOR-ENV-91bc\nVALOR-MALO-55ee\nnombre-malo=VALOR-NOMBRE-3333\nDUP=VALOR-DUP-zz99\nDUP=VALOR-DUP-zz99\n`,
    );
    await writeFile(join(dir, "secrets.env"), 'APP_KEY=VALOR-SEC-c04d\nPEM="VALOR-PEM-aa12\nmas-VALOR-PEM-aa12\n', { mode: 0o644 });
    await write(join(root, ".aws", "env", "prod", "environment.env"), "DB_DATABASE=VALOR-PROD-8c8c\n");

    const { server } = createServer({ paths, runner: recordingRunner() });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = (await client.callTool({ name: "ops_env_check", arguments: { project: "demo", env: "staging" } })) as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    const text = r.content[0]!.text;
    expect(JSON.parse(text).ok).toBe(false);

    // Segunda pasada con sintaxis válida pero los mismos valores en archivos: aislamiento, esquema y consistencia comparan sin imprimir.
    await write(join(dir, "environment.env"), `${STAGING_ENV}DB_DATABASE=VALOR-PROD-8c8c\nDB_PASSWORD=VALOR-ENV-91bc\n`);
    await writeFile(join(dir, "secrets.env"), "APP_KEY=VALOR-SEC-c04d\n", { mode: 0o644 });
    const r2 = (await client.callTool({ name: "ops_env_check", arguments: { project: "demo", env: "staging" } })) as { content: Array<{ text: string }> };
    const text2 = r2.content[0]!.text;
    expect(JSON.parse(text2).checks.find((c: Check) => c.name === "aislamiento").message).toContain("DB_DATABASE: igual a producción");

    const audit = await readFile(auditFile(paths), "utf8");
    expect(audit).toContain("ops_env_check");
    for (const v of planted) {
      expect(text, v).not.toContain(v);
      expect(text2, v).not.toContain(v);
      expect(audit, v).not.toContain(v);
    }
  });
});
