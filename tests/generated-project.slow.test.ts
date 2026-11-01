import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { projectCreate, projectPlan, projectVerify } from "../src/ops/project.js";
import { E2E_SPEC, e2eEnv } from "./helpers/e2e.js";

// LENTA: genera un proyecto real y corre composer install, migraciones y tests en SQLite,
// pnpm install, typecheck, build de ambas apps y `docker compose config`. Necesita red, PHP 8.4,
// composer, pnpm y docker (solo `compose config`; no levanta nada). Ejecuta: npm run test:slow
describe("proyecto generado (e2e)", () => {
  test("plan -> create -> verify completo", async () => {
    const env = await e2eEnv();
    const target = join(env.root, "acme");

    const plan = await projectPlan(env.ctx, { spec: E2E_SPEC, target });
    expect(plan.isError, plan.text.slice(0, 600)).toBe(false);
    const planned = JSON.parse(plan.text);
    expect(planned.conflicts).toEqual([]);
    expect(planned.plan_id).toMatch(/^plan_/);

    const created = await projectCreate(env.ctx, { plan_id: planned.plan_id });
    expect(created.isError, created.text.slice(0, 1500)).toBe(false);

    const lock = parse(await readFile(join(target, ".ops/lock.yaml"), "utf8"));
    expect(Object.keys(lock.packages)).toEqual(["shardevcom/authentications", "shardevcom/integrations", "shardevcom/repositories", "shardevcom/supports", "shardevcom/verification"]);

    await writeFile(env.projectsFile, `projects:\n  acme:\n    path: ${target}\n`);
    const verified = await projectVerify(env.ctx, { project: "acme" });
    // El resumen y la ruta del log de cada paso quedan en la salida si algo falla.
    expect(verified.isError, verified.text.slice(0, 4000)).toBe(false);
    const steps = (JSON.parse(verified.text).steps as Array<{ name: string; ok: boolean }>).map((s) => s.name);
    expect(steps).toEqual(expect.arrayContaining(["composer-install", "phpunit", "pnpm-types", "pnpm-build", "docker-compose-config"]));
  });
});
