import { afterEach, describe, expect, test } from "vitest";
import { buildOutputs, collectSteps, emptyBase } from "../src/gen/build.js";
import { loadLayers } from "../src/gen/layers.js";
import { resolveProjectSpec } from "../src/gen/spec.js";
import { DEFAULT_TEMPLATES_DIR } from "../src/ops/context.js";
import { projectPlan } from "../src/ops/project.js";
import { cleanup } from "./helpers/fixtures.js";
import { SPEC, put, setup } from "./helpers/gen-fixtures.js";

afterEach(cleanup);

const MOBILE = { app: "web", app_id: "com.demo.app", app_name: "Demo App" };
const WITH_MOBILE = { ...SPEC, mobile: MOBILE };

async function addMobileLayer(dir: string): Promise<void> {
  await put(dir, "mobile/layer.yaml", `name: mobile
scope: mobile
order: 40
requires: [mobile.app_id]
files:
  - { src: files/capacitor.txt, dest: "mobile/capacitor.txt" }
`);
  await put(dir, "mobile/files/capacitor.txt", `{{ mobile.app_id }} {{ mobile.app_name }}\n`);
}

describe("spec.mobile hasta que exista una capa de scope mobile (ADJ-07)", () => {
  test("las plantillas reales no incluyen ninguna capa de scope mobile", async () => {
    expect((await loadLayers(DEFAULT_TEMPLATES_DIR)).some((l) => l.scope === "mobile")).toBe(false);
  });

  test("rechazado: project_plan con mobile falla con invalid_spec claro y no guarda plan", async () => {
    const e = await setup();
    const target = `${e.root}/acme`;
    const o = await projectPlan(e.ctx, { spec: WITH_MOBILE, target });
    expect(o).toMatchObject({ isError: true, decision: "rejected" });
    expect(o.text).toContain("mobile todavía no está disponible");
    // sin mobile el mismo spec se planifica
    const ok = await projectPlan(e.ctx, { spec: SPEC, target });
    expect(ok.isError).toBe(false);
  });

  test("permitido: el esquema y resolveProjectSpec siguen aceptando mobile (locks anteriores resuelven)", () => {
    expect(resolveProjectSpec(WITH_MOBILE).mobile).toMatchObject({ app: "web", platforms: ["android"] });
  });

  test("permitido: app_create (onlyApps) y project_verify (collectSteps) no se ven afectados por un spec con mobile", async () => {
    const e = await setup();
    const spec = resolveProjectSpec(WITH_MOBILE);
    const out = await buildOutputs(spec, e.templates, emptyBase, { onlyApps: ["web"], lock: () => "lock" });
    expect(out.files.length).toBeGreaterThan(0);
    const layers = await loadLayers(e.templates);
    expect(() => collectSteps(layers, spec)).not.toThrow();
  });

  test("se desactiva solo cuando existe una capa mobile, que entonces se renderiza", async () => {
    const e = await setup();
    await addMobileLayer(e.templates);
    const o = await projectPlan(e.ctx, { spec: WITH_MOBILE, target: `${e.root}/acme` });
    expect(o.isError).toBe(false);
    const j = JSON.parse(o.text) as { layers: string[] };
    expect(j.layers).toContain("mobile");
    const out = await buildOutputs(resolveProjectSpec(WITH_MOBILE), e.templates, emptyBase);
    expect(out.files.find((f) => f.path === "mobile/capacitor.txt")?.content.toString()).toBe("com.demo.app Demo App\n");
    // y sin mobile en el spec la capa no genera nada
    expect((await buildOutputs(resolveProjectSpec(SPEC), e.templates, emptyBase)).files.some((f) => f.path.startsWith("mobile/"))).toBe(false);
  });

  test("a nivel de build también se rechaza (project_create reconstruye con el mismo spec)", async () => {
    const e = await setup();
    await expect(buildOutputs(resolveProjectSpec(WITH_MOBILE), e.templates, emptyBase)).rejects.toThrow(/mobile todavía no está disponible/);
  });
});

