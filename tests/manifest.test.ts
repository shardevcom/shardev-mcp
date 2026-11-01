import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertServiceName, parseManifest, requireEnvironment, resolveProject } from "../src/core/manifest.js";
import { OPS_YAML, cleanup, registerDemoProject, tempPaths, tempDir, write } from "./helpers/fixtures.js";

afterEach(cleanup);

describe("manifest", () => {
  const manifest = parseManifest(OPS_YAML());

  test("parsea un ops.yaml válido", () => {
    expect(manifest.environments.map((e) => e.name)).toEqual(["staging", "prod"]);
  });

  test("env faltante: no existe entorno por defecto", () => {
    expect(() => requireEnvironment(manifest, undefined)).toThrowError(/explícitamente/);
    expect(() => requireEnvironment(manifest, "")).toThrowError(/explícitamente/);
    expect(() => requireEnvironment(manifest, "nope")).toThrowError(/no existe/);
    expect(requireEnvironment(manifest, "prod").is_production).toBe(true);
  });

  test("is_production es obligatorio (sin default)", () => {
    const text = OPS_YAML().replace("    is_production: true\n", "");
    expect(() => parseManifest(text)).toThrowError(/is_production/);
  });

  test("rechaza claves desconocidas, entornos duplicados y cuentas mal formadas", () => {
    expect(() => parseManifest(OPS_YAML("extra: 1"))).toThrowError(/inválido/);
    expect(() => parseManifest(OPS_YAML().replace("name: prod", "name: staging"))).toThrowError(/duplicado/);
    expect(() => parseManifest(OPS_YAML().replace('"222222222222"', '"22"'))).toThrowError(/account_id/);
  });

  test("servicio ajeno al prefijo del proyecto", () => {
    expect(() => assertServiceName(manifest, "demo-web")).not.toThrow();
    expect(() => assertServiceName(manifest, "otro-web")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(manifest, "demo-")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(manifest, "xdemo-web")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(manifest, "")).toThrowError(/no pertenece/);
  });
});

describe("registro de proyectos", () => {
  test("proyecto no registrado (y sin projects.yaml)", async () => {
    const paths = await tempPaths();
    await expect(resolveProject(paths, "demo")).rejects.toMatchObject({ code: "unregistered_project" });
  });

  test("las herramientas reciben nombre, no rutas ni claves heredadas", async () => {
    const paths = await tempPaths();
    await registerDemoProject(paths);
    expect((await resolveProject(paths, "demo")).manifest.project.name).toBe("demo");
    for (const bad of ["/etc", "../demo", "constructor", "__proto__", "toString"]) {
      await expect(resolveProject(paths, bad)).rejects.toMatchObject({ code: "unregistered_project" });
    }
  });

  test("el nombre del manifest debe coincidir con el registrado", async () => {
    const paths = await tempPaths();
    const dir = await tempDir();
    await write(join(dir, "ops.yaml"), OPS_YAML().replace("name: demo", "name: otro"));
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${dir}\n`);
    await expect(resolveProject(paths, "demo")).rejects.toMatchObject({ code: "invalid_manifest" });
  });

  test("ruta relativa rechazada", async () => {
    const paths = await tempPaths();
    await write(join(paths.configDir, "projects.yaml"), "projects:\n  demo:\n    path: relativa/x\n");
    await expect(resolveProject(paths, "demo")).rejects.toMatchObject({ code: "invalid_manifest" });
  });
});

describe("projects.yaml: production_envs", () => {
  test("se carga y por defecto es vacío; el resolveProject lo expone", async () => {
    const paths = await tempPaths();
    const dir = await tempDir();
    await write(join(dir, "ops.yaml"), OPS_YAML());
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${dir}\n    production_envs: [live]\n`);
    expect((await resolveProject(paths, "demo")).productionEnvs).toEqual(["live"]);
    await write(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${dir}\n`);
    expect((await resolveProject(paths, "demo")).productionEnvs).toEqual([]);
  });
});
