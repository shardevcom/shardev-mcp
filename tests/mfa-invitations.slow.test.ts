import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { appCreate, appPlan } from "../src/ops/app.js";
import { projectCreate, projectPlan, projectVerify } from "../src/ops/project.js";
import { E2E_SPEC, e2eEnv } from "./helpers/e2e.js";

// LENTA: project_verify completo (composer, migraciones, PHPUnit con las pruebas generadas de mfa e invitations,
// pnpm tipos y build). Necesita red, PHP 8.4, composer, pnpm y docker (solo `compose config`). Ejecuta: npm run test:slow
const stepNames = (text: string): string[] => (JSON.parse(text).steps as Array<{ name: string }>).map((s) => s.name);

async function verifyOk(env: Awaited<ReturnType<typeof e2eEnv>>, name: string): Promise<string[]> {
  const verified = await projectVerify(env.ctx, { project: name });
  expect(verified.isError, verified.text.slice(0, 4000)).toBe(false);
  const steps = stepNames(verified.text);
  expect(steps).toEqual(expect.arrayContaining(["composer-sync-mfa", "composer-install", "migrate-sqlite", "phpunit", "pnpm-types", "pnpm-build"]));
  return steps;
}

describe("features mfa e invitations (e2e)", () => {
  test("project_create con mfa+invitations (web), invitations+otp (adm); luego app_create de supp (mfa) -> project_verify completo", async () => {
    const env = await e2eEnv();
    const target = join(env.root, "acme");
    const spec = {
      ...E2E_SPEC,
      apps: [{ ...E2E_SPEC.apps[0], features: ["mfa", "invitations"] }, { ...E2E_SPEC.apps[1], features: ["invitations", "otp"] }],
    };

    const plan = await projectPlan(env.ctx, { spec, target });
    expect(plan.isError, plan.text.slice(0, 800)).toBe(false);
    const created = await projectCreate(env.ctx, { plan_id: JSON.parse(plan.text).plan_id });
    expect(created.isError, created.text.slice(0, 1500)).toBe(false);
    await writeFile(env.projectsFile, `projects:\n  acme:\n    path: ${target}\n`);

    const p = await appPlan(env.ctx, { project_path: target, key: "supp", user_type: "new", features: ["mfa"] });
    expect(p.isError, p.text.slice(0, 1500)).toBe(false);
    const planned = JSON.parse(p.text);
    expect(planned.conflicts).toEqual([]);
    const c = await appCreate(env.ctx, { plan_id: planned.plan_id });
    expect(c.isError, c.text.slice(0, 3000)).toBe(false);

    const lock = parse(await readFile(join(target, ".ops/lock.yaml"), "utf8"));
    const by = Object.fromEntries(lock.spec.apps.map((a: { key: string; features: string[] }) => [a.key, a.features]));
    expect(by).toEqual({ web: ["mfa", "invitations"], adm: ["invitations", "otp"], supp: ["mfa"] });
    const files = lock.files.map((f: { path: string }) => f.path) as string[];
    expect(files).toEqual(
      expect.arrayContaining(["app/Auth/Mfa/UserMfaService.php", "app/Auth/Mfa/SuppMfaService.php", "app/Auth/Invitations/AdminInvitationService.php", "tests/Feature/SuppMfaTest.php", "tests/Feature/AdminInvitationsTest.php"]),
    );
    expect(files.filter((f) => /AdminMfa|SuppInvitation|AdminMfa/.test(f))).toEqual([]);
    expect(JSON.parse(await readFile(join(target, "composer.json"), "utf8")).require["pragmarx/google2fa"]).toBe("^9.0");

    await verifyOk(env, "acme");
    for (const app of ["web", "adm", "supp"]) {
      expect(await readFile(join(target, "public", `build-${app}`, "manifest.json"), "utf8").catch(() => ""), `build de ${app}`).not.toBe("");
    }
  });

  test("proyecto sin mfa ya verificado (con composer.lock) + app_create con mfa e invitations: el lock se sincroniza y todo pasa", async () => {
    const env = await e2eEnv();
    const target = join(env.root, "acme");
    const plan = await projectPlan(env.ctx, { spec: E2E_SPEC, target });
    expect(plan.isError, plan.text.slice(0, 800)).toBe(false);
    const created = await projectCreate(env.ctx, { plan_id: JSON.parse(plan.text).plan_id });
    expect(created.isError, created.text.slice(0, 1500)).toBe(false);
    await writeFile(env.projectsFile, `projects:\n  acme:\n    path: ${target}\n`);

    // Primera verificación: crea composer.lock SIN pragmarx/google2fa y no incluye el paso de mfa.
    const first = await projectVerify(env.ctx, { project: "acme" });
    expect(first.isError, first.text.slice(0, 4000)).toBe(false);
    expect(stepNames(first.text)).not.toContain("composer-sync-mfa");
    expect(await readFile(join(target, "composer.lock"), "utf8")).not.toContain("pragmarx/google2fa");

    const p = await appPlan(env.ctx, { project_path: target, key: "supp", user_type: "new", features: ["mfa", "invitations"] });
    expect(p.isError, p.text.slice(0, 1500)).toBe(false);
    const c = await appCreate(env.ctx, { plan_id: JSON.parse(p.text).plan_id });
    expect(c.isError, c.text.slice(0, 3000)).toBe(false);

    // Con el lock desactualizado, `composer install` solo fallaría; el paso composer-sync-mfa lo resuelve.
    await verifyOk(env, "acme");
    expect(await readFile(join(target, "composer.lock"), "utf8")).toContain("pragmarx/google2fa");
  });
});
