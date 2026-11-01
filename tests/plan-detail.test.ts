import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runProject, type CliIo } from "../src/cli-run.js";
import { plansDir } from "../src/core/paths.js";
import { applyCreate } from "../src/gen/apply.js";
import { planCreate } from "../src/gen/plan.js";
import { projectCreate, projectPlan } from "../src/ops/project.js";
import { cleanup } from "./helpers/fixtures.js";
import { SPEC, setup } from "./helpers/gen-fixtures.js";

afterEach(cleanup);

async function tree(dir: string, rel = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(out, await tree(dir, r));
    else out[r] = (await readFile(join(dir, r))).toString("base64");
  }
  return out;
}

describe("project_plan: detail summary|full (ADJ-08)", () => {
  test("por defecto resume por capa; full devuelve la lista actual; ambos describen los mismos archivos", async () => {
    const e = await setup();
    const sum = JSON.parse((await projectPlan(e.ctx, { spec: SPEC, target: join(e.root, "a") })).text);
    const explicit = JSON.parse((await projectPlan(e.ctx, { spec: SPEC, target: join(e.root, "b"), detail: "summary" })).text);
    const full = JSON.parse((await projectPlan(e.ctx, { spec: SPEC, target: join(e.root, "c"), detail: "full" })).text);

    expect(sum).not.toHaveProperty("files_to_create");
    expect(sum.detail).toBe("summary");
    expect(full).not.toHaveProperty("files_summary");
    expect(Array.isArray(full.files_to_create)).toBe(true);
    expect(explicit.files_summary).toEqual(sum.files_summary);

    // mismos archivos: el resumen es exactamente la agregación por capa de la lista completa
    const files = full.files_to_create as Array<{ path: string; bytes: number; layer: string }>;
    const byLayer = sum.files_summary.by_layer as Array<{ layer: string; files: number; bytes: number }>;
    expect(sum.files_summary.total_files).toBe(files.length);
    expect(sum.files_summary.total_bytes).toBe(files.reduce((n, f) => n + f.bytes, 0));
    expect(byLayer.reduce((n, l) => n + l.files, 0)).toBe(files.length);
    for (const l of byLayer) {
      const mine = files.filter((f) => f.layer === l.layer);
      expect(l).toEqual({ layer: l.layer, files: mine.length, bytes: mine.reduce((n, f) => n + f.bytes, 0) });
    }
    expect(byLayer.map((l) => l.layer).sort()).toEqual(["(lock)", "app", "base", "mfa"]); // (lock) = .ops/lock.yaml

    // el resto de la respuesta no cambia (los plan_id y expires_at y target difieren por llamada/destino)
    for (const k of ["edits", "commands", "conflicts", "layers", "template_hash", "kind"]) expect(sum[k]).toEqual(full[k]);
    expect(sum.target_hash).toBe(full.target_hash);
    expect(sum.plan_id).toMatch(/^plan_[0-9a-f]{32}$/);
    expect(sum.expires_at).toBe(full.expires_at);
    expect(Object.keys(sum).filter((k) => k !== "files_summary" && k !== "detail" && k !== "note")).toEqual(Object.keys(full).filter((k) => k !== "files_to_create" && k !== "note"));
  });

  test("valor inválido de detail se rechaza y no guarda plan", async () => {
    const e = await setup();
    for (const bad of ["Full", "all", "", 1, null]) {
      const o = await projectPlan(e.ctx, { spec: SPEC, target: join(e.root, "x"), detail: bad });
      expect(o).toMatchObject({ isError: true, decision: "rejected" });
      expect(o.text).toContain("detail");
    }
    await expect(readdir(plansDir(e.ctx.paths))).rejects.toThrow(); // ni siquiera existe el directorio de planes
  });

  test("un plan guardado con summary o con full se aplica igual (el plan en disco no depende de detail)", async () => {
    const e = await setup();
    const a = join(e.root, "proj-a");
    const b = join(e.root, "proj-b");
    const pa = JSON.parse((await projectPlan(e.ctx, { spec: SPEC, target: a, detail: "summary" })).text);
    const pb = JSON.parse((await projectPlan(e.ctx, { spec: SPEC, target: b, detail: "full" })).text);

    const stored = async (id: string) => {
      const j = JSON.parse(await readFile(join(plansDir(e.ctx.paths), `${id}.json`), "utf8")) as Record<string, unknown>;
      const { id: _i, target: _t, mac: _m, ...rest } = j;
      return rest;
    };
    expect(await stored(pa.plan_id)).toEqual(await stored(pb.plan_id));

    const ra = await projectCreate(e.ctx, { plan_id: pa.plan_id });
    const rb = await projectCreate(e.ctx, { plan_id: pb.plan_id });
    expect(ra.isError, ra.text).toBe(false);
    expect(rb.isError, rb.text).toBe(false);
    expect(await tree(a)).toEqual(await tree(b));
    expect(Object.keys(await tree(a))).toEqual(expect.arrayContaining(["README.md", ".ops/lock.yaml"]));
  });

  test("planCreate (interno) no cambia: sigue devolviendo files_to_create y su plan se aplica", async () => {
    const e = await setup();
    const plan = await planCreate(e.ctx, SPEC, join(e.root, "z"));
    expect(plan.files_to_create.length).toBeGreaterThan(0);
    expect((await applyCreate(e.ctx, plan.plan_id!)).ok).toBe(true);
  });

  test("CLI: --detail full/summary, valor inválido, y la salida humana cuenta los archivos", async () => {
    const e = await setup();
    const run = async (extra: string[], target: string) => {
      const out: string[] = [];
      const io: CliIo = { out: (s) => out.push(s), err: () => undefined, stdin: async () => JSON.stringify(SPEC) };
      const code = await runProject(["plan", "--spec", "-", "--target", join(e.root, target), ...extra], io, e.ctx);
      return { code, text: out.join("") };
    };
    const full = JSON.parse((await run(["--detail", "full", "--json"], "c1")).text);
    const sum = JSON.parse((await run(["--json"], "c2")).text);
    const sum2 = JSON.parse((await run(["--detail=summary", "--json"], "c3")).text);
    expect(full.files_to_create.length).toBe(sum.files_summary.total_files);
    expect(sum2.files_summary).toEqual(sum.files_summary);
    const human = await run([], "c4");
    expect(human.text).toContain(`archivos: ${full.files_to_create.length};`);
    const humanFull = await run(["--detail", "full"], "c5");
    expect(humanFull.text).toContain(`archivos: ${full.files_to_create.length};`);
    const bad = await run(["--detail", "nope"], "c6");
    expect(bad.code).toBe(1);
    expect(bad.text).toContain("detail");
  });
});
