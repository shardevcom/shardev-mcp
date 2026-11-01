import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { assertServiceName, declaredServices, parseManifest, requireCapability, requireEnvironment, resolveProject } from "../src/core/manifest.js";
import { OPS_YAML, OPS_YAML_SERVICES, cleanup, registerDemoProject, tempPaths, tempDir, write } from "./helpers/fixtures.js";

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

  test("servicio válido solo si empieza por el prefijo Y está listado en `services` de ESE entorno", () => {
    const m = parseManifest(OPS_YAML_SERVICES());
    const stg = requireEnvironment(m, "staging");
    const prod = requireEnvironment(m, "prod");
    expect(() => assertServiceName(m, prod, "demo-app")).not.toThrow();
    expect(() => assertServiceName(m, stg, "demo-staging-app")).not.toThrow();
    // el prefijo de producción también cubre `demo-staging-app`, pero no está en los services de prod
    expect("demo-staging-app".startsWith(m.service_prefix)).toBe(true);
    expect(() => assertServiceName(m, prod, "demo-staging-app")).toThrowError(/no está declarado/);
    expect(() => assertServiceName(m, stg, "demo-app")).toThrowError(/no está declarado/);
    expect(() => assertServiceName(m, prod, "otro-web")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(m, prod, "demo-")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(m, prod, "xdemo-web")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(m, prod, "")).toThrowError(/no pertenece/);
    expect(() => assertServiceName(m, prod, "demo-app ")).toThrowError(/no está declarado/);
  });

  test("sin `services` el entorno falla cerrado (sin descubrimiento) y el manifest viejo sigue parseando", () => {
    expect(manifest.environments.every((e) => e.services === undefined)).toBe(true);
    expect(() => assertServiceName(manifest, requireEnvironment(manifest, "prod"), "demo-web")).toThrowError(/no declara `services`/);
    expect(() => declaredServices(manifest, requireEnvironment(manifest, "prod"))).toThrowError(/services: \[demo-app\]/);
  });

  test("validación de `services` en el manifest", () => {
    const withSvc = (list: string): string => OPS_YAML().replace("    cluster: shared\n  - name: prod", `    cluster: shared\n    services: ${list}\n  - name: prod`);
    expect(() => parseManifest(withSvc("[]"))).toThrowError(/services/);
    expect(() => parseManifest(withSvc("[otro-web]"))).toThrowError(/service_prefix/);
    expect(() => parseManifest(withSvc("[demo-]"))).toThrowError(/service_prefix/);
    expect(() => parseManifest(withSvc("[demo-a, demo-a]"))).toThrowError(/duplicado/);
    expect(() => parseManifest(withSvc("['demo-a b']"))).toThrowError(/inválido/);
    expect(parseManifest(withSvc("[demo-a]")).environments[0]!.services).toEqual(["demo-a"]);
  });

  test("capacidades", () => {
    expect(() => requireCapability(manifest, "ecs")).not.toThrow();
    expect(() => requireCapability(manifest, "logs")).toThrowError(/capacidad "logs"/);
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
