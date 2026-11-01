import { createHash } from "node:crypto";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { parse } from "yaml";
import { applyApp, planApp } from "../src/gen/app.js";
import { planCreate } from "../src/gen/plan.js";
import { applyCreate } from "../src/gen/apply.js";
import { plansDir } from "../src/core/paths.js";
import type { ExecResult, Runner } from "../src/core/exec.js";
import { DEFAULT_TEMPLATES_DIR, createContext, type Ctx } from "../src/ops/context.js";
import { appCreate, appPlan } from "../src/ops/app.js";
import { cleanup, tempDir, tempPaths } from "./helpers/fixtures.js";
import { E2E_SPEC } from "./helpers/e2e.js";

afterEach(cleanup);
vi.setConfig({ testTimeout: 60_000 });

const ok: ExecResult = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1 };
/** Runner de pruebas: nada se ejecuta de verdad (php, composer, pnpm no hacen falta); `failOn` simula un paso que falla. */
const stubRunner = (failOn?: string): Runner => async (cmd) => (failOn && cmd === failOn ? { ...ok, exitCode: 1, stderr: "boom" } : ok);

interface Env {
  ctx: Ctx;
  root: string;
  project: string;
  templates: string;
}

/** Proyecto `acme` (web + adm) generado con las plantillas reales y un runner inerte. */
async function generate(opts: { runner?: Runner; templates?: string } = {}): Promise<Env> {
  const paths = await tempPaths();
  const root = await tempDir();
  const templates = opts.templates ?? DEFAULT_TEMPLATES_DIR;
  await writeFile(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
  const ctx = createContext(paths, { templatesDir: templates, runner: opts.runner ?? stubRunner() });
  const project = join(root, "acme");
  const plan = await planCreate(ctx, E2E_SPEC, project);
  expect(plan.conflicts).toEqual([]);
  const r = await applyCreate(ctx, plan.plan_id!);
  expect(r.ok, r.message).toBe(true);
  return { ctx, root, project, templates };
}

async function snapshot(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await readdir(join(dir, rel))).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = await lstat(join(dir, r));
    if (st.isDirectory()) Object.assign(out, await snapshot(dir, r));
    else out[r] = `${(st.mode & 0o777).toString(8)}:${createHash("sha256").update(await readFile(join(dir, r))).digest("hex")}`;
  }
  return out;
}

const SUPP = { key: "supp", user_type: "new" as const };
const input = (e: Env, extra: Record<string, unknown> = {}) => ({ project_path: e.project, ...SUPP, ...extra });
const read = (e: Env, rel: string) => readFile(join(e.project, rel), "utf8");
const put = async (e: Env, rel: string, text: string) => {
  await mkdir(dirname(join(e.project, rel)), { recursive: true });
  await writeFile(join(e.project, rel), text);
};
const plansOnDisk = async (e: Env) => (await readdir(plansDir(e.ctx.paths)).catch(() => [] as string[])).length;
const PARTNER = `<?php

namespace App\\Models;

use Shardevcom\\Authentications\\Models\\Account;

class Partner extends Account
{
    protected $table = 'partners';
}
`;

describe("features en el spec del proyecto (project_plan)", () => {
  const withFeatures = (web: Record<string, unknown>) => ({ ...E2E_SPEC, apps: [{ ...E2E_SPEC.apps[0], ...web }, E2E_SPEC.apps[1]] });

  test("web con otp+social genera sus capas solo en web; adm queda igual que sin features", async () => {
    const paths = await tempPaths();
    const root = await tempDir();
    await writeFile(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
    const ctx = createContext(paths, { runner: stubRunner() });
    const plan = await planCreate(ctx, withFeatures({ features: ["otp", "social"], social_providers: ["google", "apple"] }), join(root, "acme"));
    expect(plan.conflicts).toEqual([]);
    const paths2 = plan.files_to_create.map((f) => f.path);
    expect(paths2).toEqual(expect.arrayContaining(["app/Auth/Otp/UserOtpService.php", "app/Auth/Social/UserSocialService.php", "tests/Feature/UserOtpLoginTest.php", "tests/Feature/UserSocialLoginTest.php", "resources/react/web/src/pages/auth/sign-in/otp-form.tsx", "resources/react/web/src/pages/auth/sign-in/social-buttons.tsx"]));
    expect(paths2.filter((p) => /Admin(Otp|Social)|adm-(otp|social)|resources\/react\/adm\/.*(otp|social)/.test(p))).toEqual([]);
    const base = await planCreate(ctx, E2E_SPEC, join(root, "acme2"));
    expect(base.files_to_create.map((f) => f.path)).not.toEqual(expect.arrayContaining(["app/Auth/Otp/UserOtpService.php"]));
  });

  test("mfa e invitations se rechazan con el mensaje de capa inexistente", async () => {
    const paths = await tempPaths();
    const root = await tempDir();
    await writeFile(join(paths.configDir, "config.yaml"), `allowed_roots:\n  - ${root}\n`);
    const ctx = createContext(paths, { runner: stubRunner() });
    for (const f of ["mfa", "invitations"]) {
      await expect(planCreate(ctx, withFeatures({ features: [f] }), join(root, "acme"))).rejects.toThrow(/todavía no existe/);
    }
  });
});

describe("app_plan", () => {
  test("planifica sin escribir nada: archivos de app, edits por ancla y plan_id", async () => {
    const e = await generate();
    const before = await snapshot(e.project);
    const plan = await planApp(e.ctx, input(e));
    expect(plan.conflicts).toEqual([]);
    expect(plan.plan_id).toMatch(/^plan_[0-9a-f]{32}$/);
    expect(plan.app).toMatchObject({ key: "supp", provider: "supps", table: "supps", model: "Supp", api_guard: "supp", session_guard: "supp_session", port: 5175, build_dir: "build-supp" });
    const paths = plan.files_to_create.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["app/Models/Supp.php", "routes/api/supp.php", "resources/react/supp/package.json", "database/migrations/2025_09_10_000100_create_supps_table.php"]));
    // solo capas de app: ningún archivo de proyecto se vuelve a renderizar
    expect(plan.layers).toEqual(["app-model", "app-auth", "app-react", "app-workspace"]);
    expect(paths.some((p) => p.startsWith("tests/") || p === "composer.json" || p === ".env" || p.startsWith("packages/"))).toBe(false);
    expect(plan.edits.find((x) => x.file === "config/auth.php")?.diff).toContain("'supp_session'");
    expect(plan.edits.find((x) => x.type === "lock")?.diff).toContain("supp");
    expect(await snapshot(e.project)).toEqual(before);
  });

  test("el puerto por defecto es el primero libre y uno explícito se respeta", async () => {
    const e = await generate();
    expect((await planApp(e.ctx, input(e))).app.port).toBe(5175);
    expect((await planApp(e.ctx, input(e, { port: 6000 }))).app.port).toBe(6000);
  });

  test("rechaza key inválida o reservada, o ya usada", async () => {
    const e = await generate();
    for (const key of ["Supp", "1supp", "sup-p", "a/b", "../x", ""]) {
      const r = await appPlan(e.ctx, input(e, { key }));
      expect(r.isError, key).toBe(true);
      expect(r.text).toMatch(/key/);
    }
    for (const key of ["api", "storage", "list", "static", "vendor", "oauth"]) {
      const r = await appPlan(e.ctx, input(e, { key }));
      expect(r.isError, key).toBe(true);
      expect(r.text).toMatch(/reservada/);
    }
    const used = await appPlan(e.ctx, input(e, { key: "web" }));
    expect(used.isError).toBe(true);
    expect(used.text).toMatch(/ya está en uso/);
    expect(await plansOnDisk(e)).toBe(0);
  });

  test("rechaza colisiones de guard, provider, tabla, modelo y puerto con las apps existentes", async () => {
    const e = await generate();
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ api_guard: "adm" }, /guard duplicado "adm"/],
      [{ api_guard: "web" }, /guard duplicado "web"/],
      [{ session_guard: "admin" }, /guard duplicado "admin"/],
      [{ session_guard: "website" }, /guard duplicado "website"/],
      [{ api_guard: "same", session_guard: "same" }, /guard duplicado "same"/],
      [{ table: "admins" }, /tabla duplicado "admins"|duplicado "admins"/],
      [{ provider: "users" }, /duplicado "users"/],
      [{ model: "Admin" }, /duplicado "Admin"/],
      [{ port: 5173 }, /duplicado "5173"/],
      [{ build_dir: "build-web" }, /duplicado "build-web"/],
      [{ table: "sessions" }, /reservada/],
      [{ model: "Account" }, /reservado/],
    ];
    for (const [extra, re] of cases) {
      const r = await appPlan(e.ctx, input(e, extra));
      expect(r.isError, JSON.stringify(extra)).toBe(true);
      expect(r.text, JSON.stringify(extra)).toMatch(re);
    }
    expect(await plansOnDisk(e)).toBe(0);
  });

  test("rechaza un guard que el dueño ya escribió a mano en config/auth.php", async () => {
    const e = await generate();
    const auth = await read(e, "config/auth.php");
    await put(e, "config/auth.php", auth.replace("// shardev:guards", "'supp' => ['driver' => 'session', 'provider' => 'users'],\n        // shardev:guards"));
    const r = await appPlan(e.ctx, input(e));
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.text).conflicts.join("\n")).toContain('config/auth.php: ya declara "supp"');
  });

  test("proyecto no creado por shardev (sin lock) o fuera de allowed_roots", async () => {
    const e = await generate();
    const plain = join(e.root, "plain");
    await mkdir(plain);
    const a = await appPlan(e.ctx, input(e, { project_path: plain }));
    expect(a.isError).toBe(true);
    expect(a.text).toMatch(/no fue creado por shardev/);
    const outside = await mkdtemp(join(tmpdir(), "shardev-outside-"));
    const b = await appPlan(e.ctx, input(e, { project_path: outside }));
    expect(b.isError).toBe(true);
    expect(b.text).toMatch(/fuera de las raíces permitidas/);
    const c = await appPlan(e.ctx, input(e, { project_path: "relativo/acme" }));
    expect(c.isError).toBe(true);
    const d = await appPlan(e.ctx, input(e, { project_path: `${e.project}/../acme` }));
    expect(d.isError).toBe(true);
  });

  test("features: mfa e invitations siguen rechazadas (la capa no existe), lo desconocido también, otp y social se aceptan", async () => {
    const e = await generate();
    expect((await planApp(e.ctx, input(e, { features: [] }))).plan_id).toMatch(/^plan_/);
    for (const features of [["mfa"], ["invitations"], ["otp", "mfa"], ["inventada"]]) {
      const r = await appPlan(e.ctx, input(e, { features }));
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/todavía no existe|desconocida/);
    }
    const otp = await planApp(e.ctx, input(e, { features: ["otp"] }));
    expect(otp.plan_id).toMatch(/^plan_/);
    expect(otp.files_to_create.map((f) => f.path)).toEqual(expect.arrayContaining(["app/Auth/Otp/SuppOtpService.php", "routes/api/supp-otp.php", "tests/Feature/SuppOtpLoginTest.php"]));
    expect(otp.files_to_create.some((f) => f.path.includes("social"))).toBe(false);
    expect(otp.app).toMatchObject({ features: ["otp"], auto_register: false });
    const social = await planApp(e.ctx, input(e, { features: ["social"], social_providers: ["google"] }));
    expect(social.plan_id).toMatch(/^plan_/);
    expect(social.files_to_create.map((f) => f.path)).toEqual(expect.arrayContaining(["app/Auth/Social/SuppSocialService.php", "database/migrations/2026_01_01_000200_create_supps_social_identities_table.php"]));
    // los edits de app-auth no cambian: el signin por contraseña sigue en una app sin otp
    const authRoutes = social.files_to_create.find((f) => f.path === "routes/api/supp.php");
    expect(authRoutes).toBeDefined();
    expect((await appPlan(e.ctx, { ...input(e), nuevo_campo: 1 })).isError).toBe(true); // esquema estricto
  });

  test("social exige proveedores válidos (google, microsoft, apple), y auto_register solo con otp o social", async () => {
    const e = await generate();
    expect((await appPlan(e.ctx, input(e, { features: ["social"] }))).text).toMatch(/requiere social_providers/);
    expect((await appPlan(e.ctx, input(e, { features: ["social"], social_providers: ["facebook"] }))).isError).toBe(true);
    expect((await appPlan(e.ctx, input(e, { social_providers: ["google"] }))).text).toMatch(/sin la feature social/);
    expect((await appPlan(e.ctx, input(e, { auto_register: true }))).text).toMatch(/auto_register/);
    expect((await planApp(e.ctx, input(e, { features: ["otp"], auto_register: true }))).app.auto_register).toBe(true);
  });

  test("otp: la app generada no registra signin ni change-password por contraseña; sin otp sí", async () => {
    const e = await generate();
    const withOtp = await planApp(e.ctx, input(e, { features: ["otp"] }));
    const r = await applyApp(e.ctx, withOtp.plan_id!);
    expect(r.ok, r.message).toBe(true);
    const routes = await read(e, "routes/api/supp.php");
    expect(routes).not.toMatch(/Route::post\('auth\/(signin|change-password)'/);
    expect(await read(e, "routes/api/supp-otp.php")).toMatch(/throttle:6,1,otp-request-supp/);
    expect(await read(e, "config/otp_supp.php")).toMatch(/'auto_register' => false/);
    const web = await read(e, "routes/api/web.php");
    expect(web).toMatch(/Route::post\('auth\/signin'/);
  });

  test("un archivo destino que ya existe detiene el plan, lo nombra y no se pisa", async () => {
    const e = await generate();
    await put(e, "routes/api/supp.php", "<?php\n// mío\n");
    const before = await snapshot(e.project);
    const r = await appPlan(e.ctx, input(e));
    expect(r.isError).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.plan_id).toBeNull();
    expect(out.conflicts.join("\n")).toContain("routes/api/supp.php: ya existe");
    expect(await read(e, "routes/api/supp.php")).toBe("<?php\n// mío\n");
    expect(await snapshot(e.project)).toEqual({ ...before });
    expect(await plansOnDisk(e)).toBe(0);
  });

  test("un ancla eliminada o editada detiene el plan nombrando el archivo, sin escribir nada", async () => {
    for (const [file, anchor] of [["config/shardevcom.php", "// shardev:roles"], ["config/auth.php", "// shardev:providers"], ["config/authentications.php", "// shardev:apps"]] as const) {
      const e = await generate();
      await put(e, file, (await read(e, file)).replace(anchor, "// ancla editada por el dueño"));
      const before = await snapshot(e.project);
      const r = await appPlan(e.ctx, input(e));
      expect(r.isError, file).toBe(true);
      const out = JSON.parse(r.text);
      expect(out.plan_id).toBeNull();
      expect(out.conflicts.join("\n"), file).toContain(`${file}: ancla no encontrada`);
      expect(await snapshot(e.project)).toEqual(before);
      expect(await plansOnDisk(e)).toBe(0);
    }
  });

  test("un edit ya aplicado a mano no se omite en silencio", async () => {
    const e = await generate();
    const pkg = JSON.parse(await read(e, "package.json"));
    pkg.scripts["build:supp"] = "pnpm --filter @acme/supp build";
    pkg.scripts["dev:supp"] = "pnpm --filter @acme/supp dev";
    pkg.scripts["types:supp"] = "pnpm --filter @acme/supp types";
    await put(e, "package.json", `${JSON.stringify(pkg, null, 4)}\n`);
    const r = await appPlan(e.ctx, input(e));
    // json-merge con los mismos valores es no-op: se reporta, no se ignora
    expect(r.isError).toBe(true);
    expect(r.text).toContain("package.json");
    expect(r.text).toMatch(/ya estaba aplicado/);
  });

  test("lo que escribe pasa el escaneo de restos: key que contiene un término configurado en leftover_terms", async () => {
    const e = await generate();
    await writeFile(join(e.ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${e.root}\nleftover_terms:\n  - acme-legacy\n`);
    const r = await appPlan(e.ctx, input(e, { key: "acmelegacy" }));
    expect(r.isError).toBe(false);
    await writeFile(join(e.ctx.paths.configDir, "config.yaml"), `allowed_roots:\n  - ${e.root}\nleftover_terms:\n  - acmelegacy\n`);
    const bad = await appPlan(e.ctx, input(e, { key: "acmelegacy" }));
    expect(bad.isError).toBe(true);
    // la key coincide con el término, pero el término no está en el nombre del proyecto (acme)
    expect(JSON.parse(bad.text).conflicts.join("\n")).toMatch(/routes\/api\/acmelegacy\.php:\d+: resto de otro proyecto \(leftover_terms:acmelegacy\)/);
  });

  test("el escaneo de secretos revisa lo que se va a escribir (plantilla con un literal de credencial)", async () => {
    const templates = await mkdtemp(join(tmpdir(), "shardev-tpl-"));
    await cp(DEFAULT_TEMPLATES_DIR, templates, { recursive: true });
    const e = await generate({ templates });
    const ctrl = join(templates, "app-auth/files/AuthController.php");
    await writeFile(ctrl, `${await readFile(ctrl, "utf8")}\n$api_key = 'abcdef1234567890abcdef';\n`);
    const r = await appPlan(e.ctx, input(e));
    expect(r.isError).toBe(true);
    const out = JSON.parse(r.text);
    expect(out.conflicts.join("\n")).toMatch(/app\/Http\/Controllers\/SuppAuthController\.php:\d+: posible secreto/);
    expect(r.text).not.toContain("abcdef1234567890abcdef");
  });

  test("rama master/main de un repo git se rechaza", async () => {
    const e = await generate();
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: e.project });
    const ctx = createContext(e.ctx.paths, { runner: (await import("../src/core/exec.js")).exec });
    const r = await appPlan(ctx, input(e));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/nunca se trabaja sobre master\/main/);
  });
});

describe("app_create", () => {
  test("añade la app: archivos nuevos, edits por ancla, lock con spec y hashes; no toca archivos de proyecto", async () => {
    const e = await generate();
    const before = await snapshot(e.project);
    const lockBefore = parse(await read(e, ".ops/lock.yaml"));
    const plan = await planApp(e.ctx, input(e));
    const res = await applyApp(e.ctx, plan.plan_id!);
    expect(res.ok, res.message).toBe(true);
    const after = await snapshot(e.project);

    const created = Object.keys(after).filter((p) => !(p in before));
    expect(created.sort()).toEqual(plan.files_to_create.map((f) => f.path).sort());
    const changed = Object.keys(before).filter((p) => before[p] !== after[p]).sort();
    expect(changed).toEqual(
      [".ops/lock.yaml", "config/auth.php", "config/authentications.php", "config/shardevcom.php", "config/supports.php", "package.json", "pnpm-workspace.yaml", "tsconfig.json"].sort(),
    );
    // archivos de proyecto jamás re-renderizados ni tocados (incluidos .env y los secretos locales)
    for (const untouched of [".env", ".env.example", "composer.json", "tests/Feature/GuardIsolationTest.php", "bootstrap/app.php", "routes/web.php", "routes/api.php", "docker-compose.yml"]) {
      expect(after[untouched], untouched).toBe(before[untouched]);
    }
    expect(await read(e, "config/auth.php")).toContain("'supp_session' => ['driver' => 'session', 'provider' => 'supps']");
    expect(await read(e, "config/authentications.php")).toContain("'supp' => [");
    expect(JSON.parse(await read(e, "package.json")).scripts["build:supp"]).toBeDefined();
    expect(await read(e, "pnpm-workspace.yaml")).toContain("resources/react/supp");

    const lock = parse(await read(e, ".ops/lock.yaml"));
    expect(lock.spec.apps.map((a: { key: string }) => a.key)).toEqual(["web", "adm", "supp"]);
    expect(lock.spec.apps[2]).toMatchObject({ user_type: "new", table: "supps", port: 5175 });
    expect(lock.template_hash).toBe(lockBefore.template_hash);
    expect(lock.local_files).toEqual(lockBefore.local_files);
    expect(lock.packages).toEqual(lockBefore.packages);
    const hashOf = async (p: string) => createHash("sha256").update(await readFile(join(e.project, p))).digest("hex");
    for (const f of ["app/Models/Supp.php", "routes/api/supp.php", "config/auth.php", "package.json"]) {
      expect(lock.files.find((x: { path: string }) => x.path === f)?.sha256, f).toBe(await hashOf(f));
    }
    // el plan se consume
    await expect(applyApp(e.ctx, plan.plan_id!)).rejects.toThrow(/No existe ese plan/);
  });

  test("un plan_id con conflictos no existe; app_create nunca acepta datos de la app", async () => {
    const e = await generate();
    const r = await appCreate(e.ctx, { plan_id: "plan_00000000000000000000000000000000" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No existe ese plan/);
  });

  test("un archivo relevante que cambia entre plan y apply: se niega y no escribe nada", async () => {
    const targets: Array<[string, (e: Env) => Promise<void>]> = [
      ["edit tocado", async (e) => put(e, "config/auth.php", `${await read(e, "config/auth.php")}\n// cambio del dueño\n`)],
      ["lock", async (e) => put(e, ".ops/lock.yaml", `${await read(e, ".ops/lock.yaml")}# nota\n`)],
      ["destino creado", async (e) => put(e, "resources/views/supp.blade.php", "mío")],
      ["ancla eliminada", async (e) => put(e, "config/supports.php", (await read(e, "config/supports.php")).replace("// shardev:permission-guards", ""))],
    ];
    for (const [name, mutate] of targets) {
      const e = await generate();
      const plan = await planApp(e.ctx, input(e));
      await mutate(e);
      const before = await snapshot(e.project);
      await expect(applyApp(e.ctx, plan.plan_id!), name).rejects.toThrow(/Genera un plan nuevo con app_plan|plan nuevo/);
      expect(await snapshot(e.project), name).toEqual(before);
    }
  });

  test("plan expirado o manipulado se rechaza", async () => {
    const e = await generate();
    const plan = await planApp(e.ctx, input(e));
    const file = join(plansDir(e.ctx.paths), `${plan.plan_id}.json`);
    const j = JSON.parse(await readFile(file, "utf8"));
    j.app.table = "otra";
    await writeFile(file, JSON.stringify(j));
    await expect(applyApp(e.ctx, plan.plan_id!)).rejects.toThrow(/integridad/);
  });

  test("fallo tras escribir archivos (hook): se restauran los editados y se borran los creados y sus carpetas", async () => {
    const e = await generate();
    const before = await snapshot(e.project);
    const plan = await planApp(e.ctx, input(e));
    let n = 0;
    const res = await applyApp(e.ctx, plan.plan_id!, {
      afterWrite: (p) => {
        n++;
        if (p === "config/auth.php") throw new Error("fallo de cableado simulado");
      },
    });
    expect(n).toBeGreaterThan(10);
    expect(res.ok).toBe(false);
    expect(res.rolled_back).toBe(true);
    expect(res.message).toMatch(/fallo de cableado simulado/);
    expect(await snapshot(e.project)).toEqual(before);
    await expect(lstat(join(e.project, "resources/react/supp"))).rejects.toThrow();
  });

  test("fallo en la escritura de un edit (archivo de solo lectura): rollback completo", async () => {
    if (process.getuid?.() === 0) return; // root ignora permisos
    const e = await generate();
    const before = await snapshot(e.project);
    const plan = await planApp(e.ctx, input(e));
    await chmod(join(e.project, "config/supports.php"), 0o444);
    const res = await applyApp(e.ctx, plan.plan_id!);
    await chmod(join(e.project, "config/supports.php"), 0o644);
    expect(res.ok).toBe(false);
    expect(res.rolled_back).toBe(true);
    const after = await snapshot(e.project);
    expect(after).toEqual(before);
  });

  test("fallo de verificación posterior (paso php-lint): rollback completo", async () => {
    const e = await generate();
    const before = await snapshot(e.project);
    const plan = await planApp(e.ctx, input(e));
    const ctx = createContext(e.ctx.paths, { runner: stubRunner("php") });
    const res = await applyApp(ctx, plan.plan_id!);
    expect(res.ok).toBe(false);
    expect(res.rolled_back).toBe(true);
    expect(res.verify?.steps.some((s) => !s.ok)).toBe(true);
    expect(await snapshot(e.project)).toEqual(before);
  });

  test("deriva del dueño en un archivo editado: se aplica por ancla, se avisa y el hash del lock no se actualiza", async () => {
    const e = await generate();
    await put(e, "config/supports.php", `${await read(e, "config/supports.php")}\n// del dueño\n`);
    const lockBefore = parse(await read(e, ".ops/lock.yaml"));
    const plan = await planApp(e.ctx, input(e));
    expect(plan.notes.join("\n")).toContain("config/supports.php difiere del hash del lock");
    expect((await applyApp(e.ctx, plan.plan_id!)).ok).toBe(true);
    expect(await read(e, "config/supports.php")).toContain("// del dueño");
    const lock = parse(await read(e, ".ops/lock.yaml"));
    const rec = (l: typeof lock) => l.files.find((x: { path: string }) => x.path === "config/supports.php").sha256;
    expect(rec(lock)).toBe(rec(lockBefore));
  });

  test("dos apps seguidas: la segunda parte del lock actualizado", async () => {
    const e = await generate();
    expect((await applyApp(e.ctx, (await planApp(e.ctx, input(e))).plan_id!)).ok).toBe(true);
    const second = await planApp(e.ctx, input(e, { key: "partner" }));
    expect(second.conflicts).toEqual([]);
    expect(second.app.port).toBe(5176);
    expect((await applyApp(e.ctx, second.plan_id!)).ok).toBe(true);
    const lock = parse(await read(e, ".ops/lock.yaml"));
    expect(lock.spec.apps.map((a: { key: string }) => a.key)).toEqual(["web", "adm", "supp", "partner"]);
    // y una tercera con la misma key de la primera se rechaza
    expect((await appPlan(e.ctx, input(e))).isError).toBe(true);
  });
});

describe("user_type existing", () => {
  const partner = (extra: Record<string, unknown> = {}) => ({ key: "partner", user_type: "existing" as const, model: "Partner", ...extra });

  test("sin modelo => falla en el plan", async () => {
    const e = await generate();
    const r = await appPlan(e.ctx, { project_path: e.project, ...partner() });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("app/Models/Partner.php");
    expect(r.text).toMatch(/exige que .* exista/);
  });

  test("modelo que no extiende Account (o solo lo menciona comentado) => falla", async () => {
    const e = await generate();
    for (const body of [
      "<?php\nnamespace App\\Models;\nuse Illuminate\\Database\\Eloquent\\Model;\nclass Partner extends Model {}\n",
      "<?php\nnamespace App\\Models;\n// class Partner extends Account\nclass Partner {}\n",
      "<?php\nnamespace App\\Models;\nclass Partner extends Account {}\n", // sin el use
      "<?php\nnamespace App\\Models;\nuse Shardevcom\\Authentications\\Models\\Account;\nclass Partner extends Base {}\n",
    ]) {
      await put(e, "app/Models/Partner.php", body);
      const r = await appPlan(e.ctx, { project_path: e.project, ...partner() });
      expect(r.isError, body).toBe(true);
      expect(r.text).toMatch(/app\/Models\/Partner\.php existe pero no es una cuenta válida/);
    }
    expect(await plansOnDisk(e)).toBe(0);
  });

  test("tabla distinta de la que declara el modelo => falla; sin tabla se toma la del modelo", async () => {
    const e = await generate();
    await put(e, "app/Models/Partner.php", PARTNER);
    const bad = await appPlan(e.ctx, { project_path: e.project, ...partner({ table: "otras" }) });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/no coincide con la tabla que declara/);
    const good = await planApp(e.ctx, { project_path: e.project, ...partner() });
    expect(good.app.table).toBe("partners");
  });

  test("modelo válido: sin tabla ni migración ni modelo nuevos; sí guards, rutas y SPA; el modelo no se toca", async () => {
    const e = await generate();
    await put(e, "app/Models/Partner.php", PARTNER);
    const plan = await planApp(e.ctx, { project_path: e.project, ...partner() });
    expect(plan.conflicts).toEqual([]);
    expect(plan.layers).not.toContain("app-model");
    const paths = plan.files_to_create.map((f) => f.path);
    expect(paths.some((p) => p.startsWith("database/"))).toBe(false);
    expect(paths).not.toContain("app/Models/Partner.php");
    expect(paths).toEqual(expect.arrayContaining(["routes/api/partner.php", "app/Http/Controllers/PartnerAuthController.php", "resources/react/partner/package.json"]));
    expect(plan.notes.join("\n")).toMatch(/no define factory/);
    const before = await snapshot(e.project);
    const res = await applyApp(e.ctx, plan.plan_id!);
    expect(res.ok, res.message).toBe(true);
    const after = await snapshot(e.project);
    expect(after["app/Models/Partner.php"]).toBe(before["app/Models/Partner.php"]);
    expect(Object.keys(after).filter((p) => p.startsWith("database/") && !(p in before))).toEqual([]);
    expect(await read(e, "config/auth.php")).toContain("Partner::class");
    const lock = parse(await read(e, ".ops/lock.yaml"));
    expect(lock.spec.apps.at(-1)).toMatchObject({ key: "partner", user_type: "existing", table: "partners", model: "Partner" });
  });

  test("el modelo existente no puede ser el de otra app", async () => {
    const e = await generate();
    const r = await appPlan(e.ctx, { project_path: e.project, key: "other", user_type: "existing", model: "User" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/duplicado "User"/);
  });
});

describe("shardev app (CLI)", () => {
  const io = () => {
    const out: string[] = [];
    return { out, io: { out: (s: string) => out.push(s), err: () => undefined, stdin: async () => "" } };
  };

  test("plan --json y create comparten resultado con las funciones de ops; --features acepta otp/social y rechaza mfa", async () => {
    const { runApp } = await import("../src/cli-run.js");
    const e = await generate();
    const a = io();
    expect(await runApp(["plan", "--project-path", e.project, "--key", "supp", "--user-type", "new", "--port", "5300", "--features", "", "--json"], a.io, e.ctx)).toBe(0);
    const plan = JSON.parse(a.out.join(""));
    expect(plan.plan_id).toMatch(/^plan_/);
    expect(plan.app.port).toBe(5300);

    const bad = io();
    expect(await runApp(["plan", "--project-path", e.project, "--key", "supp2", "--user-type", "new", "--features", "mfa", "--json"], bad.io, e.ctx)).toBe(1);
    expect(bad.out.join("")).toMatch(/todavía no existe/);

    const b = io();
    expect(await runApp(["create", "--plan-id", plan.plan_id, "--json"], b.io, e.ctx)).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ ok: true, kind: "app", app: "supp" });

    const h = io();
    expect(await runApp(["plan", "--project-path", e.project, "--key", "supp", "--user-type", "new"], h.io, e.ctx)).toBe(1); // ya usada
    await expect(runApp(["plan", "--key", "x"], io().io, e.ctx)).rejects.toThrow(/Falta --project-path/);
    await expect(runApp(["plan", "--project-path", e.project, "--key", "x", "--user-type", "new", "--port", "abc"], io().io, e.ctx)).rejects.toThrow(/--port/);
    await expect(runApp(["bogus"], io().io, e.ctx)).rejects.toThrow(/desconocido/);
  });
});
