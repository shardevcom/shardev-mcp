import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { appCreate, appPlan } from "../src/ops/app.js";
import { projectCreate, projectPlan, projectVerify } from "../src/ops/project.js";
import { E2E_SPEC, e2eEnv } from "./helpers/e2e.js";

// LENTA: `web` con otp+social y `adm` sin features; luego app_create de `supp` con social. project_verify completo
// (composer, migraciones, PHP incluidos los tests de las features, pnpm, tipos y build). Necesita red, PHP 8.4,
// composer, pnpm y docker (solo `compose config`). Ejecuta: npm run test:slow
describe("features otp y social (e2e)", () => {
  test("web (otp+social), adm (nada) + supp (social) -> project_verify completo", async () => {
    const env = await e2eEnv();
    const target = join(env.root, "acme");
    const spec = {
      ...E2E_SPEC,
      apps: [{ ...E2E_SPEC.apps[0], features: ["otp", "social"], social_providers: ["google", "microsoft", "apple"] }, E2E_SPEC.apps[1]],
    };

    const plan = await projectPlan(env.ctx, { spec, target });
    expect(plan.isError, plan.text.slice(0, 800)).toBe(false);
    const created = await projectCreate(env.ctx, { plan_id: JSON.parse(plan.text).plan_id });
    expect(created.isError, created.text.slice(0, 1500)).toBe(false);
    await writeFile(env.projectsFile, `projects:\n  acme:\n    path: ${target}\n`);

    const p = await appPlan(env.ctx, { project_path: target, key: "supp", user_type: "new", features: ["social"], social_providers: ["google"] });
    expect(p.isError, p.text.slice(0, 1500)).toBe(false);
    const planned = JSON.parse(p.text);
    expect(planned.conflicts).toEqual([]);
    const c = await appCreate(env.ctx, { plan_id: planned.plan_id });
    expect(c.isError, c.text.slice(0, 3000)).toBe(false);

    const lock = parse(await readFile(join(target, ".ops/lock.yaml"), "utf8"));
    const by = Object.fromEntries(lock.spec.apps.map((a: { key: string; features: string[] }) => [a.key, a.features]));
    expect(by).toEqual({ web: ["otp", "social"], adm: [], supp: ["social"] });
    const files = lock.files.map((f: { path: string }) => f.path) as string[];
    expect(files).toEqual(expect.arrayContaining(["app/Auth/Otp/UserOtpService.php", "app/Auth/Social/SuppSocialService.php", "tests/Feature/SuppSocialLoginTest.php"]));
    expect(files.filter((f) => /Admin(Otp|Social)|adm-(otp|social)/.test(f))).toEqual([]);

    const verified = await projectVerify(env.ctx, { project: "acme" });
    expect(verified.isError, verified.text.slice(0, 4000)).toBe(false);
    const steps = (JSON.parse(verified.text).steps as Array<{ name: string; ok: boolean }>).map((s) => s.name);
    expect(steps).toEqual(expect.arrayContaining(["composer-install", "migrate-sqlite", "phpunit", "pnpm-types", "pnpm-build"]));
    for (const app of ["web", "adm", "supp"]) {
      expect(await readFile(join(target, "public", `build-${app}`, "manifest.json"), "utf8").catch(() => ""), `build de ${app}`).not.toBe("");
    }
  });
});
