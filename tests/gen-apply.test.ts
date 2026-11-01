import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { parse } from "yaml";
import { planCreate, planExisting } from "../src/gen/plan.js";
import { applyCreate, applyExisting } from "../src/gen/apply.js";
import { plansDir } from "../src/core/paths.js";
import { cleanup, registerDemoProject } from "./helpers/fixtures.js";
import { SPEC, git, makeRepo, put, setup, writeTemplates } from "./helpers/gen-fixtures.js";
import { createContext } from "../src/ops/context.js";
import { projectVerify } from "../src/ops/project.js";

afterEach(cleanup);

const exists = (p: string) => stat(p).then(() => true, () => false);
const read = (...p: string[]) => readFile(join(...p), "utf8");

describe("project_plan (puro)", () => {
  test("devuelve archivos, diffs de edits, comandos, plan_id y no crea nada", async () => {
    const { ctx, root } = await setup();
    const target = join(root, "acme");
    const plan = await planCreate(ctx, SPEC, target);
    expect(plan.plan_id).toMatch(/^plan_[0-9a-f]{32}$/);
    expect(plan.conflicts).toEqual([]);
    expect(plan.layers).toEqual(["base", "app", "mfa"]);
    const paths = plan.files_to_create.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["README.md", "apps/web/app.json", "apps/adm/app.json", "apps/web/mfa.txt", ".ops/lock.yaml"]));
    expect(paths).not.toContain("apps/adm/mfa.txt"); // mfa solo en web
    const pkgDiff = plan.edits.filter((e) => e.file === "package.json").map((e) => e.diff).join("\n");
    expect(pkgDiff).toContain('+    "dev:web": "vite --port 5173"');
    expect(plan.edits.find((e) => e.file === "config/auth.php")?.diff).toContain("+        'web' => ['driver' => 'passport', 'provider' => 'webs'],");
    expect(plan.commands.map((c) => c.name)).toEqual(["readme-present"]);
    expect(plan.commands[0]?.env).toEqual({ LANG: "C.UTF-8" });
    expect(plan.expires_at).toBe("2026-11-01T12:30:00.000Z");
    expect(await exists(target)).toBe(false);
    expect((await stat(join(plansDir(ctx.paths), `${plan.plan_id}.json`))).mode & 0o777).toBe(0o600);
  });

  test("variable desconocida en una plantilla es error", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "base/files/README.md", "{{ project.nombre }}");
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/variable desconocida "project.nombre"/);
  });

  test("variable requerida sin usar es error", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "base/files/README.md", "sin variables");
    await put(templates, "base/files/nginx.conf", "x");
    await put(templates, "base/files/package.json", '{"name":"x","scripts":{}}\n');
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/requerida "project.name" no se usa/);
  });

  test("bloque sin cerrar en una plantilla es error", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "base/files/README.md", "{{#if project.name}}abierto");
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/sin cerrar/);
  });

  test("destino de archivo con traversal en layer.yaml o por variable es error", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "evil/layer.yaml", `name: evil\nscope: project\nfiles:\n  - { src: files/x, dest: "../escape.txt" }\n`);
    await put(templates, "evil/files/x", "x");
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/inválida/);
    await put(templates, "evil/layer.yaml", `name: evil\nscope: project\nfiles:\n  - { src: "../base/files/README.md", dest: "x.txt" }\n`);
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/inválida/);
  });

  test("ancla ausente => conflicto y sin plan_id; ancla ambigua idem", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "base/files/auth.php", "<?php\n// nada\n");
    const p = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(p.plan_id).toBeNull();
    expect(p.conflicts.join("\n")).toMatch(/ancla no encontrada/);
    await put(templates, "base/files/auth.php", "<?php\n// shardev:guards\n// shardev:guards\n");
    const q = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(q.plan_id).toBeNull();
    expect(q.conflicts.join("\n")).toMatch(/ancla ambigua/);
  });

  test("colisión de archivo entre capas es conflicto", async () => {
    const { ctx, root, templates } = await setup();
    await put(templates, "dup/layer.yaml", `name: dup\nscope: project\norder: 50\nfiles:\n  - { src: files/x, dest: README.md }\n`);
    await put(templates, "dup/files/x", "x");
    const p = await planCreate(ctx, SPEC, join(root, "acme"));
    expect(p.plan_id).toBeNull();
    expect(p.conflicts[0]).toMatch(/README.md: ya existe/);
  });

  test("el spec inválido se rechaza antes de planear", async () => {
    const { ctx, root } = await setup();
    await expect(planCreate(ctx, { ...SPEC, apps: [{ key: "../x", user_type: "new", port: 5000 }] }, join(root, "acme"))).rejects.toThrow(/Spec inválido/);
  });
});

describe("project_create", () => {
  test("crea el proyecto: cableado aplicado, $VAR intacto, modos, lock sin secretos, plan de un solo uso", async () => {
    const { ctx, root } = await setup();
    const target = join(root, "acme");
    const plan = await planCreate(ctx, SPEC, target);
    const r = await applyCreate(ctx, plan.plan_id!);
    expect(r.ok).toBe(true);
    expect(r.temp_dir).toBeUndefined();
    expect((await readdir(root)).filter((n) => n.includes("shardev-tmp"))).toEqual([]);

    const pkg = JSON.parse(await read(target, "package.json"));
    expect(pkg.scripts).toEqual({ "dev:web": "vite --port 5173", "dev:adm": "vite --port 5174" });
    expect(await read(target, "pnpm-workspace.yaml")).toMatch(/- apps\/web\n\s+- apps\/adm/);
    const auth = await read(target, "config/auth.php");
    expect(auth).toContain("'web' => ['driver' => 'passport', 'provider' => 'webs'],");
    expect(auth.indexOf("'adm'")).toBeLessThan(auth.indexOf("// shardev:guards"));
    expect(await read(target, "routes/web.php")).toContain("Route::view('/web', 'web');");
    const nginx = await read(target, "docker/nginx.conf");
    expect(nginx).toContain("proxy_set_header Host $host;");
    expect(nginx).toContain("${UPSTREAM}");
    expect(nginx).toContain("server_name acme.example.com;");
    expect(await read(target, "bin/run.sh")).toContain('echo "$HOME ${APP_ENV:-x}"');
    expect((await stat(join(target, "bin/run.sh"))).mode & 0o777).toBe(0o755);
    expect(await read(target, "README.md")).toContain("Rewards activado.");

    const lock = parse(await read(target, ".ops/lock.yaml"));
    expect(lock).toMatchObject({ version: 1, layers: ["base", "app", "mfa"], spec: { name: "acme" } });
    expect(lock.template_hash).toBe(plan.template_hash);
    expect(JSON.stringify(lock)).not.toMatch(/secret|password|token/i);

    // un plan se aplica una sola vez
    await expect(applyCreate(ctx, plan.plan_id!)).rejects.toThrow(/No existe ese plan/);
  });

  test("plan expirado se rechaza", async () => {
    const { ctx, root, clock } = await setup();
    const plan = await planCreate(ctx, SPEC, join(root, "acme"));
    clock.t += 31 * 60 * 1000;
    await expect(applyCreate(ctx, plan.plan_id!)).rejects.toThrow(/expiró/);
    expect(await exists(join(root, "acme"))).toBe(false);
  });

  test("plan manipulado se rechaza (spec, destino, expiración o archivo ilegible)", async () => {
    const { ctx, root } = await setup();
    const file = async (id: string) => join(plansDir(ctx.paths), `${id}.json`);
    const tamper = async (mut: (o: Record<string, unknown>) => void) => {
      const p = await planCreate(ctx, SPEC, join(root, "acme"));
      const f = await file(p.plan_id!);
      const o = JSON.parse(await readFile(f, "utf8"));
      mut(o);
      await writeFile(f, JSON.stringify(o));
      return p.plan_id!;
    };
    await expect(applyCreate(ctx, await tamper((o) => ((o.spec as { domain: string }).domain = "evil.example.com")))).rejects.toThrow(/integridad/);
    await expect(applyCreate(ctx, await tamper((o) => (o.target = "/etc")))).rejects.toThrow(/integridad/);
    await expect(applyCreate(ctx, await tamper((o) => (o.expires_at = "2099-01-01T00:00:00.000Z")))).rejects.toThrow(/integridad/);
    await expect(applyCreate(ctx, await tamper((o) => delete o.mac))).rejects.toThrow(/integridad/);
    const p = await planCreate(ctx, SPEC, join(root, "acme"));
    await writeFile(await file(p.plan_id!), "no json");
    await expect(applyCreate(ctx, p.plan_id!)).rejects.toThrow(/JSON válido/);
    expect(await exists(join(root, "acme"))).toBe(false);
  });

  test("project_create solo acepta plan_id con forma válida (nunca un spec ni una ruta)", async () => {
    const { ctx } = await setup();
    await expect(applyCreate(ctx, "../../etc/passwd")).rejects.toThrow(/plan_id inválido/);
    await expect(applyCreate(ctx, JSON.stringify(SPEC))).rejects.toThrow(/plan_id inválido/);
  });

  test("destino no vacío: el plan lo marca como conflicto y apply lo rechaza si se ocupó después", async () => {
    const { ctx, root } = await setup();
    const busy = join(root, "busy");
    await mkdir(busy);
    await writeFile(join(busy, "x"), "x");
    const p = await planCreate(ctx, SPEC, busy);
    expect(p.plan_id).toBeNull();
    expect(p.conflicts.join()).toMatch(/no está vacío/);

    const target = join(root, "later");
    const ok = await planCreate(ctx, SPEC, target); // libre al planear
    await mkdir(target);
    await writeFile(join(target, "intruso"), "x");
    await expect(applyCreate(ctx, ok.plan_id!)).rejects.toThrow(/no está vacío/);
    expect(await readdir(target)).toEqual(["intruso"]);
  });

  test("destino vacío existente: se acepta y se reemplaza atómicamente", async () => {
    const { ctx, root } = await setup();
    const target = join(root, "empty");
    await mkdir(target);
    const r = await applyCreate(ctx, (await planCreate(ctx, SPEC, target)).plan_id!);
    expect(r.ok).toBe(true);
    expect(await exists(join(target, "README.md"))).toBe(true);
  });

  test("destino fuera de la raíz permitida (ruta, .., symlink, sin config)", async () => {
    const { ctx, root, paths } = await setup();
    await expect(planCreate(ctx, SPEC, "/tmp/shardev-fuera/acme")).rejects.toThrow(/fuera de las raíces/);
    await expect(planCreate(ctx, SPEC, join(root, "..", "otro"))).rejects.toThrow(/normalizada|fuera/);
    await expect(planCreate(ctx, SPEC, root)).rejects.toThrow(/fuera de las raíces/); // la raíz misma no
    const outside = join(root, "..", `fuera-${Date.now()}`);
    await mkdir(outside);
    await symlink(outside, join(root, "link"));
    await expect(planCreate(ctx, SPEC, join(root, "link", "acme"))).rejects.toThrow(/fuera de las raíces/);
    await writeFile(join(paths.configDir, "config.yaml"), "allowed_roots: []\n");
    await expect(planCreate(ctx, SPEC, join(root, "acme"))).rejects.toThrow(/No hay raíces permitidas/);
  });

  test("un plan válido deja de serlo si la raíz permitida se quita antes de aplicar", async () => {
    const { ctx, root, paths } = await setup();
    const p = await planCreate(ctx, SPEC, join(root, "acme"));
    await writeFile(join(paths.configDir, "config.yaml"), "allowed_roots: []\n");
    await expect(applyCreate(ctx, p.plan_id!)).rejects.toThrow(/No hay raíces permitidas/);
  });

  test("verificación fallida: el destino queda intacto y el temporal se conserva", async () => {
    const { ctx, root } = await setup({ failingStep: true });
    const target = join(root, "acme");
    const r = await applyCreate(ctx, (await planCreate(ctx, SPEC, target)).plan_id!);
    expect(r.ok).toBe(false);
    expect(r.target_untouched).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(r.temp_dir && (await exists(join(r.temp_dir, "README.md")))).toBe(true);
    expect(r.verify?.steps.at(-1)).toMatchObject({ name: "always-fails", ok: false, exit_code: 3 });
    expect(r.verify?.steps[0]?.log_ref).toMatch(/\.log$/);
    // y con un destino vacío preexistente: sigue vacío
    const empty = join(root, "empty");
    await mkdir(empty);
    const r2 = await applyCreate(ctx, (await planCreate(ctx, SPEC, empty)).plan_id!);
    expect(r2.ok).toBe(false);
    expect(await readdir(empty)).toEqual([]);
  });

  test("un secreto en un archivo generado hace fallar la verificación", async () => {
    const { ctx, root } = await setup({ readmeExtra: "clave: AKIAIOSFODNN7EXAMPLE\n" });
    const target = join(root, "acme");
    const r = await applyCreate(ctx, (await planCreate(ctx, SPEC, target)).plan_id!);
    expect(r.ok).toBe(false);
    expect(await exists(target)).toBe(false);
    expect(r.verify?.secrets.hits).toEqual([{ path: "README.md", line: expect.any(Number) }]);
    expect(JSON.stringify(r)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  test("secreto tipo `password: valor` y marcador de excepción", async () => {
    const a = await setup({ readmeExtra: "db_password: hunter2hunter2\n" });
    const r = await applyCreate(a.ctx, (await planCreate(a.ctx, SPEC, join(a.root, "acme"))).plan_id!);
    expect(r.ok).toBe(false);
    const b = await setup({ readmeExtra: "db_password: example-only # shardev-allow-secret\n" });
    const r2 = await applyCreate(b.ctx, (await planCreate(b.ctx, SPEC, join(b.root, "acme"))).plan_id!);
    expect(r2.ok).toBe(true);
  });

  test("las plantillas cambiadas tras planear invalidan el plan", async () => {
    const { ctx, root, templates } = await setup();
    const p = await planCreate(ctx, SPEC, join(root, "acme"));
    await put(templates, "base/files/README.md", "# cambiado {{ project.name }} {{ project.domain }}");
    await expect(applyCreate(ctx, p.plan_id!)).rejects.toThrow(/plantillas cambiaron/);
  });
});

describe("apply sobre repo existente", () => {
  const prep = async (extra: { failingStep?: boolean } = {}) => {
    const e = await setup({ base: false, ...extra });
    const repo = await makeRepo(e.root);
    return { ...e, repo };
  };
  const spec = { ...SPEC, apps: [{ key: "web", user_type: "new", port: 5173, features: ["mfa"] }] };

  test("crea una rama nueva, escribe ahí y deja intacta la rama original", async () => {
    const { ctx, repo } = await prep();
    const baseSha = git(repo, "rev-parse", "develop");
    const plan = await planExisting(ctx, spec, repo, { label: "app" });
    expect(plan.conflicts).toEqual([]);
    expect(plan.branch).toMatchObject({ base: "develop" });
    expect(plan.branch?.name).toMatch(/^shardev\/app-acme-[0-9a-f]{8}$/);
    expect(plan.edits.map((e) => e.file)).toEqual(expect.arrayContaining(["package.json", "pnpm-workspace.yaml", "config/auth.php", "routes/web.php"]));
    expect(git(repo, "status", "--porcelain")).toBe(""); // planear no toca nada

    const r = await applyExisting(ctx, plan.plan_id!);
    expect(r.ok).toBe(true);
    expect(r.branch).toBe(plan.branch?.name);
    expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe(plan.branch?.name);
    expect(git(repo, "rev-parse", "develop")).toBe(baseSha); // develop intacta
    expect(git(repo, "rev-parse", "HEAD")).toBe(baseSha); // sin commits ni push
    expect(git(repo, "remote")).toBe("");
    expect(await read(repo, "package.json")).toContain('"dev:web": "vite --port 5173"');
    expect(await exists(join(repo, ".ops/lock.yaml"))).toBe(true);
    expect(await exists(join(repo, "apps/web/mfa.txt"))).toBe(true);
    // la rama original no tiene ninguno de los cambios
    git(repo, "stash", "-u", "-q");
    git(repo, "switch", "-q", "develop");
    expect(await read(repo, "package.json")).not.toContain("dev:web");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  test("árbol sucio: se rechaza (en el plan y en el apply)", async () => {
    const { ctx, repo } = await prep();
    const plan = await planExisting(ctx, spec, repo);
    await writeFile(join(repo, "sucio.txt"), "x");
    await expect(applyExisting(ctx, plan.plan_id!)).rejects.toThrow(/no está limpio/);
    expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("develop");
    expect(git(repo, "branch", "--list", "shardev/*")).toBe("");
    const dirty = await planExisting(ctx, spec, repo);
    expect(dirty.plan_id).toBeNull();
    expect(dirty.conflicts.join()).toMatch(/no está limpio/);
    await writeFile(join(repo, "package.json"), '{"name":"x","scripts":{}}\n'); // modificado
    await expect(applyExisting(ctx, plan.plan_id!)).rejects.toThrow(/no está limpio/);
  });

  test("el hash del destino cambió (nuevo commit o archivo afectado distinto): se rechaza", async () => {
    const { ctx, repo } = await prep();
    const plan = await planExisting(ctx, spec, repo);
    await put(repo, "otro.txt", "x");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "otro");
    await expect(applyExisting(ctx, plan.plan_id!)).rejects.toThrow(/cambió desde el plan/);
    expect(git(repo, "branch", "--list", "shardev/*")).toBe("");
    // cambio en un archivo que el plan edita, ya commiteado
    const fresh = await planExisting(ctx, spec, repo);
    await put(repo, "routes/web.php", "<?php\n// shardev:routes\n// extra\n");
    git(repo, "commit", "-qam", "toca routes");
    await expect(applyExisting(ctx, fresh.plan_id!)).rejects.toThrow(/cambió desde el plan/);
  });

  test("nunca se trabaja sobre master/main ni se parte de ellas", async () => {
    const { ctx, root } = await setup({ base: false });
    for (const b of ["main", "master"]) {
      const repo = await makeRepo(root, `r-${b}`, b);
      const p = await planExisting(ctx, spec, repo);
      expect(p.plan_id).toBeNull();
      expect(p.conflicts.join()).toMatch(/nunca se trabaja sobre master\/main/);
      expect(git(repo, "status", "--porcelain")).toBe("");
    }
  });

  test("un plan existente también exige estar bajo una raíz permitida y ser un repo git", async () => {
    const { ctx, root } = await setup({ base: false });
    await expect(planExisting(ctx, spec, "/tmp")).rejects.toThrow(/fuera de las raíces/);
    const plain = join(root, "plain");
    await mkdir(plain);
    const p = await planExisting(ctx, spec, plain);
    expect(p.plan_id).toBeNull();
    expect(p.conflicts.join()).toMatch(/no es la raíz de un repositorio git/);
  });

  test("verificación fallida: se revierte, la rama se elimina y todo queda como estaba", async () => {
    const { ctx, repo, templates } = await prep();
    await put(templates, "app/layer.yaml", (await read(templates, "app/layer.yaml")) + "verify:\n  - { name: boom, argv: [node, -e, 'process.exit(2)'] }\n");
    const baseSha = git(repo, "rev-parse", "develop");
    const plan = await planExisting(ctx, spec, repo);
    const r = await applyExisting(ctx, plan.plan_id!);
    expect(r.ok).toBe(false);
    expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("develop");
    expect(git(repo, "branch", "--list", "shardev/*")).toBe("");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "rev-parse", "develop")).toBe(baseSha);
    expect(await exists(join(repo, "apps"))).toBe(false);
  });

  test("plan de proyecto nuevo no sirve para repo existente y viceversa", async () => {
    const { ctx, root, repo, paths } = await prep();
    const full = await setup();
    const c = await planCreate(createContext(paths, { templatesDir: full.templates, now: ctx.now }), spec, join(root, "nuevo"));
    await expect(applyExisting(ctx, c.plan_id!)).rejects.toThrow(/tipo "create"/);
    const e = await planExisting(ctx, spec, repo);
    await expect(applyCreate(ctx, e.plan_id!)).rejects.toThrow(/tipo "existing"/);
  });
});

describe("project_verify", () => {
  test("re-verifica un proyecto generado; detecta un secreto añadido después; los pasos vienen de las plantillas", async () => {
    const { ctx, root, paths } = await setup();
    const target = join(root, "acme");
    await applyCreate(ctx, (await planCreate(ctx, SPEC, target)).plan_id!);
    await registerDemoProject(paths); // crea projects.yaml
    await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  acme:\n    path: ${target}\n`);
    const ok = await projectVerify(ctx, { project: "acme" });
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.text)).toMatchObject({ ok: true, steps: [{ name: "readme-present", ok: true }] });

    // un agente edita el lock para colar un comando: se ignora (los pasos salen de las plantillas)
    const lock = await read(target, ".ops/lock.yaml");
    await writeFile(join(target, ".ops/lock.yaml"), lock + "steps:\n  - { name: pwn, argv: [touch, pwned] }\n");
    await projectVerify(ctx, { project: "acme" });
    expect(await exists(join(target, "pwned"))).toBe(false);

    await writeFile(join(target, "README.md"), "token: abcdef123456secretvalue\n");
    const bad = await projectVerify(ctx, { project: "acme" });
    expect(bad.isError).toBe(true);
    expect(JSON.parse(bad.text).secrets.hits).toEqual([{ path: "README.md", line: 1 }]);
    expect(bad.text).not.toContain("abcdef123456secretvalue");
  });

  test("proyecto no registrado o sin lock", async () => {
    const { ctx, paths } = await setup();
    expect((await projectVerify(ctx, { project: "nope" })).text).toMatch(/no está registrado/);
    const dir = join(paths.configDir, "vacio");
    await mkdir(dir);
    await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  vacio:\n    path: ${dir}\n`);
    expect((await projectVerify(ctx, { project: "vacio" })).text).toMatch(/lock\.yaml/);
  });
});
