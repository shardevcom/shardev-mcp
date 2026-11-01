import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { applyCreate } from "../src/gen/apply.js";
import { planCreate } from "../src/gen/plan.js";
import { projectVerify } from "../src/ops/project.js";
import { Redactor } from "../src/core/redact.js";
import { forbiddenFor, lineHasSecret } from "../src/gen/verify.js";
import { SPEC, put, setup } from "./helpers/gen-fixtures.js";

const read = (root: string, rel: string): Promise<string> => readFile(join(root, rel), "utf8");

async function extraLayer(templates: string, extra = ""): Promise<void> {
  await put(templates, "extra/layer.yaml", `name: extra
scope: project
order: 15
requires: [project.name]
files:
  - { tree: files/tree, dest: out, render: [".json", "named.txt"] }
  - { src: files/env, dest: .env }
verify:
  - { name: heavy, argv: [node, -e, "require('fs').writeFileSync('heavy-ran','1')"], full: true }
${extra}`);
  await put(templates, "extra/files/tree/a.json", `{"name": "{{ project.name }}"}\n`);
  await put(templates, "extra/files/tree/raw.txt", `literal {{ no es variable }}\n`);
  await put(templates, "extra/files/tree/{{ project.name }}-named.txt", `n={{ project.name }}\n`);
  await put(templates, "extra/files/tree/deep/x/y.php", `<?php // {{ project.domain }} no se renderiza\n`);
  await put(templates, "extra/files/env", `APP_KEY={{ secret.app_key }}\nDB_PASSWORD={{ secret.db_password }}\nDB_ROOT={{ secret.db_password }}\n`);
  await put(templates, "extra/files/packages-src/x.php", "<?php\n");
}

describe("motor: tree, secretos locales, pasos full, restos", () => {
  test("tree: renderiza solo lo declarado, nombres con variables, subcarpetas", async () => {
    const { ctx, root, templates } = await setup();
    await extraLayer(templates);
    const plan = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(plan.conflicts).toEqual([]);
    const r = await applyCreate(ctx, plan.plan_id!);
    expect(r.ok).toBe(true);
    const t = join(root, "acme");
    expect(await read(t, "out/a.json")).toBe(`{"name": "acme"}\n`);
    expect(await read(t, "out/raw.txt")).toContain("{{ no es variable }}");
    expect(await read(t, "out/acme-named.txt")).toBe("n=acme\n");
    expect(await read(t, "out/deep/x/y.php")).toContain("{{ project.domain }}");
  });

  test("secretos locales: el plan es reproducible, al aplicar son aleatorios, 0600, fuera del lock y sin escaneo", async () => {
    const { ctx, root, templates } = await setup();
    await extraLayer(templates);
    const p1 = await planCreate(ctx, SPEC, join(root, "acme"));
    const p2 = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(p1.plan_id).not.toBe(p2.plan_id); // dos planes, mismo contenido
    const r = await applyCreate(ctx, p1.plan_id!);
    expect(r.ok).toBe(true); // APP_KEY=base64:... no dispara el escaneo porque .env no se escanea
    const env = await read(join(root, "acme"), ".env");
    expect(env).not.toContain("@@SHARDEV_SECRET");
    const app = /^APP_KEY=(base64:[A-Za-z0-9+/=]{44})$/m.exec(env);
    expect(app).not.toBeNull();
    const pw = /^DB_PASSWORD=([0-9a-f]{48})$/m.exec(env);
    expect(pw).not.toBeNull();
    expect(env).toContain(`DB_ROOT=${pw![1]}`); // mismo nombre, mismo valor
    expect((await stat(join(root, "acme/.env"))).mode & 0o777).toBe(0o600);
    const lock = parse(await read(join(root, "acme"), ".ops/lock.yaml"));
    expect(lock.files.map((f: { path: string }) => f.path)).not.toContain(".env");
    expect(lock.local_files).toEqual([".env"]);
    // otro proyecto => otros valores
    const other = await planCreate(ctx, SPEC, join(root, "acme2"));
    await applyCreate(ctx, other.plan_id!);
    expect(await read(join(root, "acme2"), ".env")).not.toContain(app![1]!);
  });

  test("paso full: project_create no lo corre, project_verify sí; el plan indica dónde corre", async () => {
    const { ctx, root, templates, paths } = await setup();
    await extraLayer(templates);
    const plan = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(plan.commands.find((c) => c.name === "heavy")?.runs_in).toBe("project_verify");
    expect(plan.commands.find((c) => c.name === "readme-present")?.runs_in).toBe("project_create");
    await applyCreate(ctx, plan.plan_id!);
    await expect(stat(join(root, "acme/heavy-ran"))).rejects.toThrow();
    await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  acme:\n    path: ${join(root, "acme")}\n`);
    const v = await projectVerify(ctx, { project: "acme" });
    expect(v.isError).toBe(false);
    expect((await stat(join(root, "acme/heavy-ran"))).isFile()).toBe(true);
  });

  test("restos genéricos (ECR/ARN con cuenta) hacen fallar la creación aunque no haya leftover_terms", async () => {
    for (const leak of ["123456789012.dkr.ecr.us-east-1.amazonaws.com/x", "arn:aws:iam::123456789012:role/x"]) {
      const { ctx, root, templates } = await setup();
      await put(templates, "base/files/README.md", `# {{ project.name }}\n{{ project.domain }}\n${leak}\n`);
      const plan = await planCreate(ctx, SPEC, join(root, "acme"));
      const r = await applyCreate(ctx, plan.plan_id!);
      expect(r.ok, leak).toBe(false);
      expect(r.verify?.leftovers.hits.length, leak).toBeGreaterThan(0);
      expect(r.message).toContain("resto(s) de otro proyecto");
    }
  });

  test("sin leftover_terms configurado, un nombre de otro proyecto no se considera resto", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "base/files/README.md", `# {{ project.name }}\n{{ project.domain }}\nAcme-Legacy\n`);
    const plan = await planCreate(ctx, SPEC, join(root, "acme"));
    expect((await applyCreate(ctx, plan.plan_id!)).ok).toBe(true);
  });

  test("leftover_terms: un término configurado hace fallar la creación (sin distinguir mayúsculas, literal); el nombre propio exime", async () => {
    for (const leak of ["Proyecto ACME-LEGACY", "com.acme-legacy.app"]) {
      const { ctx, root, templates } = await setup();
      await writeFile(join(ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\nleftover_terms:\n  - acme-legacy\n`);
      await put(templates, "base/files/README.md", `# {{ project.name }}\n{{ project.domain }}\n${leak}\n`);
      const plan = await planCreate(ctx, SPEC, join(root, "acme"));
      const r = await applyCreate(ctx, plan.plan_id!);
      expect(r.ok, leak).toBe(false);
      expect(r.verify?.leftovers.hits.length, leak).toBeGreaterThan(0);
      expect(r.message).toContain("resto(s) de otro proyecto");
    }
    // el término es literal: los metacaracteres de regex no se interpretan
    const lit = await setup();
    await writeFile(join(lit.ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${lit.root}\nleftover_terms:\n  - "a.c+"\n`);
    await put(lit.templates, "base/files/README.md", `# {{ project.name }}\n{{ project.domain }}\nabcc\n`);
    const litPlan = await planCreate(lit.ctx, SPEC, join(lit.root, "acme"));
    expect((await applyCreate(lit.ctx, litPlan.plan_id!)).ok).toBe(true);
    // un término contenido en el nombre del proyecto no cuenta
    const { ctx, root, templates } = await setup();
    await writeFile(join(ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\nleftover_terms:\n  - acme-legacy\n`);
    await put(templates, "base/files/README.md", `# {{ project.name }}\n{{ project.domain }}\nacme-legacy\n`);
    const plan = await planCreate(ctx, { ...SPEC, name: "acme-legacy-clone" }, join(root, "rc"));
    expect((await applyCreate(ctx, plan.plan_id!)).ok).toBe(true);
  });

  test("leftover_terms no altera el plan: mismo contenido y hashes con o sin términos configurados", async () => {
    const { ctx, root } = await setup();
    const p1 = await planCreate(ctx, SPEC, join(root, "acme"));
    await writeFile(join(ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\nleftover_terms:\n  - acme-legacy\n`);
    const p2 = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(p2.files_to_create).toEqual(p1.files_to_create);
    expect(p2.template_hash).toBe(p1.template_hash);
    expect(p2.target_hash).toBe(p1.target_hash);
    expect(forbiddenFor({ name: "acme", domain: "acme.example.com" }, ["B-term", "a-term"]).map((f) => f.name))
      .toEqual(forbiddenFor({ name: "acme", domain: "acme.example.com" }, ["a-term", "B-term", "a-term"]).map((f) => f.name));
  });

  test("lock: hash por paquete copiado", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "pk/layer.yaml", `name: pk
scope: project
order: 12
files:
  - { tree: files/packages, dest: packages }
`);
    await put(templates, "pk/files/packages/shardevcom/supports/composer.json", "{}\n");
    await put(templates, "pk/files/packages/shardevcom/supports/src/A.php", "<?php\n");
    await put(templates, "pk/files/packages/shardevcom/verification/composer.json", "{}\n");
    const plan = await planCreate(ctx, SPEC, join(root, "acme"));
    await applyCreate(ctx, plan.plan_id!);
    const lock = parse(await read(join(root, "acme"), ".ops/lock.yaml"));
    expect(Object.keys(lock.packages)).toEqual(["shardevcom/supports", "shardevcom/verification"]);
    expect(lock.packages["shardevcom/supports"]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("escaneo de secretos consciente del tipo de archivo", () => {
  const ctx = { redactor: new Redactor() };

  test("en código fuente, identificadores y llamadas no son secretos", () => {
    const code = [
      "private const JWKS_CACHE_KEY = 'google_jwks';",
      "$token = $account->token();",
      "password: z.string().min(1, 'La contraseña es obligatoria'),",
      "'new_password' => ['required', 'string', Password::min(10)],",
      "refresh_token: '',",
    ];
    for (const l of code) expect(lineHasSecret(ctx, "src/x.php", l), l).toBe(false);
  });

  test("en código fuente, un literal de credencial o un token con forma conocida sí lo son", () => {
    expect(lineHasSecret(ctx, "app/Foo.php", "$password = 'hunter2hunter2';")).toBe(true);
    expect(lineHasSecret(ctx, "config/x.php", "'client_secret' => 'abcDEF123456xyz',")).toBe(true);
    expect(lineHasSecret(ctx, "src/a.ts", "const k = 'AKIAABCDEFGHIJKLMNOP';")).toBe(true);
  });

  test("en config/texto sigue el redactor completo, pero las referencias ${VAR} no cuentan", () => {
    expect(lineHasSecret(ctx, "docker-compose.yml", "DB_PASSWORD: ${DB_PASSWORD:?falta}")).toBe(false);
    expect(lineHasSecret(ctx, "docker-compose.yml", "MYSQL_PASSWORD: ultrasecreta123")).toBe(true);
    expect(lineHasSecret(ctx, "README.md", "password: valor")).toBe(true);
    expect(lineHasSecret(ctx, ".env.example", "DB_PASSWORD=")).toBe(false);
  });
});
