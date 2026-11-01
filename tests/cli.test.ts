import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { runProject, type CliIo } from "../src/cli-run.js";
import { SPEC, setup } from "./helpers/gen-fixtures.js";

function io(stdin = ""): { io: CliIo; out: string[] } {
  const out: string[] = [];
  return { out, io: { out: (s) => out.push(s), err: () => undefined, stdin: async () => stdin } };
}

describe("shardev project (misma lógica que las herramientas)", () => {
  test("plan --json, create y verify comparten resultado con las funciones de ops", async () => {
    const { ctx, root, paths } = await setup();
    const target = join(root, "acme");
    const a = io(JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", "-", "--target", target, "--json"], a.io, ctx)).toBe(0);
    const plan = JSON.parse(a.out.join(""));
    expect(plan.plan_id).toMatch(/^plan_/);

    const b = io();
    expect(await runProject(["create", "--plan-id", plan.plan_id, "--json"], b.io, ctx)).toBe(0);
    expect(JSON.parse(b.out.join(""))).toMatchObject({ ok: true, kind: "create", target });

    await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  acme:\n    path: ${target}\n`);
    const c = io();
    expect(await runProject(["verify", "--project", "acme", "--json"], c.io, ctx)).toBe(0);
    expect(JSON.parse(c.out.join(""))).toMatchObject({ ok: true, project: "acme" });
  });

  test("salida humana y errores de uso", async () => {
    const { ctx, root } = await setup();
    const a = io();
    const spec = join(root, "spec.json");
    await writeFile(spec, JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", spec, "--target", join(root, "acme")], a.io, ctx)).toBe(0);
    expect(a.out.join("")).toContain("plan_id: plan_");
    await expect(runProject(["plan", "--target", "x"], io().io, ctx)).rejects.toThrow(/Falta --spec/);
    await expect(runProject(["bogus"], io().io, ctx)).rejects.toThrow(/desconocido/);
    const bad = io("{no json");
    await expect(runProject(["plan", "--spec", "-", "--target", join(root, "z")], bad.io, ctx)).rejects.toThrow(/JSON válido/);
  });

  test("un destino fuera de las raíces permitidas sale con código 1", async () => {
    const { ctx } = await setup();
    const a = io(JSON.stringify(SPEC));
    expect(await runProject(["plan", "--spec", "-", "--target", "/etc/acme", "--json"], a.io, ctx)).toBe(1);
  });
});
