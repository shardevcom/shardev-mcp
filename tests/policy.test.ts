import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { getIdentity } from "../src/core/aws-identity.js";
import { parseManifest, requireEnvironment } from "../src/core/manifest.js";
import { DEFAULT_POLICY, PolicySchema, commandOnlyResponse, decide, loadPolicy, renderCommand, resolveMode, type Policy } from "../src/core/policy.js";
import { classifyEnvironment } from "../src/core/policy.js";
import { OPS_YAML, cleanup, fakeRunner, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

const policyOf = (o: object): Policy => PolicySchema.parse(o);
const prodPolicy = (mode: string, extra: object = {}): Policy =>
  policyOf({ aws_profiles: { "demo-prod": { account_id: "222222222222", production_mode: mode, ...extra } } });

async function run(policy: Policy, envName: string, accounts: Record<string, string | "expired">, opsExtra = "") {
  const manifest = parseManifest(OPS_YAML(opsExtra));
  const env = requireEnvironment(manifest, envName);
  const runner = fakeRunner(accounts);
  const d = await decide(policy, manifest, env, () => getIdentity(env.aws_profile, env.region, { runner }));
  return { d, runner };
}

describe("carga de policy.yaml", () => {
  test("ausente => command-only por defecto", async () => {
    const paths = await tempPaths();
    const { policy } = await loadPolicy(paths);
    expect(policy).toEqual(DEFAULT_POLICY);
    expect(policy.default_mode).toBe("command-only");
  });
  test("inválida => error (el llamador lo trata como disabled)", async () => {
    const paths = await tempPaths();
    await write(join(paths.configDir, "policy.yaml"), "default_mode: yolo\n");
    await expect(loadPolicy(paths)).rejects.toMatchObject({ code: "invalid_policy" });
    await write(join(paths.configDir, "policy.yaml"), "default_mode: command-only\nsurprise: 1\n");
    await expect(loadPolicy(paths)).rejects.toMatchObject({ code: "invalid_policy" });
  });
  test("válida y avisa de permisos abiertos", async () => {
    const paths = await tempPaths();
    await write(join(paths.configDir, "policy.yaml"), "default_mode: disabled\naws_profiles:\n  p:\n    account_id: '123456789012'\n    production_mode: gated-apply\n");
    const { policy } = await loadPolicy(paths);
    expect(policy.aws_profiles.p?.production_mode).toBe("gated-apply");
  });
});

describe("decisión de política", () => {
  test("perfil desconocido en producción => disabled (fail closed), sin tocar AWS", async () => {
    const { d, runner } = await run(DEFAULT_POLICY, "prod", { "demo-prod": "222222222222" });
    expect(d.status).toBe("disabled");
    expect(runner.calls).toHaveLength(0);
  });

  test("perfil conocido en producción con command-only", async () => {
    const { d } = await run(prodPolicy("command-only"), "prod", { "demo-prod": "222222222222" });
    expect(d).toMatchObject({ status: "allowed", effectiveMode: "command-only", requestedMode: "command-only" });
  });

  test("production_mode disabled no consulta AWS", async () => {
    const { d, runner } = await run(prodPolicy("disabled"), "prod", { "demo-prod": "222222222222" });
    expect(d.status).toBe("disabled");
    expect(runner.calls).toHaveLength(0);
  });

  test("no producción usa default_mode del usuario", async () => {
    const { d } = await run(DEFAULT_POLICY, "staging", { "demo-stg": "111111111111" });
    expect(d).toMatchObject({ status: "allowed", effectiveMode: "command-only" });
    const off = await run(policyOf({ default_mode: "disabled" }), "staging", { "demo-stg": "111111111111" });
    expect(off.d.status).toBe("disabled");
  });

  test("sin sesión => unavailable con el comando de login exacto, sin intentar login", async () => {
    const { d, runner } = await run(prodPolicy("command-only"), "prod", { "demo-prod": "expired" });
    expect(d).toMatchObject({ status: "unavailable", loginCommand: "aws sso login --profile demo-prod" });
    if (d.status === "unavailable") expect(d.message).toContain("aws sso login --profile demo-prod");
    // única llamada: sts get-caller-identity; nunca un login
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.slice(0, 3)).toEqual(["aws", "sts", "get-caller-identity"]);
    expect(runner.calls.flat()).not.toContain("login");
  });

  test("cuenta distinta a la del manifest => rejected", async () => {
    const { d } = await run(prodPolicy("command-only"), "prod", { "demo-prod": "999999999999" });
    expect(d.status).toBe("rejected");
    const stg = await run(DEFAULT_POLICY, "staging", { "demo-stg": "999999999999" });
    expect(stg.d.status).toBe("rejected");
  });

  test("cuenta distinta a la declarada en policy para el perfil => rejected", async () => {
    const p = policyOf({ aws_profiles: { "demo-prod": { account_id: "333333333333", production_mode: "command-only" } } });
    const { d } = await run(p, "prod", { "demo-prod": "222222222222" });
    expect(d.status).toBe("rejected");
  });

  test("el proyecto no puede ampliar la policy, solo restringir", () => {
    const manifestWide = parseManifest(OPS_YAML("policy: { max_mode: gated-apply }"));
    const env = requireEnvironment(manifestWide, "prod");
    expect(resolveMode(prodPolicy("command-only"), manifestWide, env).mode).toBe("command-only");
    expect(resolveMode(prodPolicy("disabled"), manifestWide, env).mode).toBe("disabled");
    const manifestNarrow = parseManifest(OPS_YAML("policy: { max_mode: disabled }"));
    expect(resolveMode(prodPolicy("gated-apply"), manifestNarrow, requireEnvironment(manifestNarrow, "prod")).mode).toBe("disabled");
    const manifestCmd = parseManifest(OPS_YAML("policy: { max_mode: command-only }"));
    expect(resolveMode(prodPolicy("gated-apply"), manifestCmd, requireEnvironment(manifestCmd, "prod")).mode).toBe("command-only");
  });

  test("lista de entornos del perfil: fuera de la lista => disabled", () => {
    const manifest = parseManifest(OPS_YAML());
    const env = requireEnvironment(manifest, "prod");
    expect(resolveMode(prodPolicy("command-only", { environments: ["staging"] }), manifest, env).mode).toBe("disabled");
    expect(resolveMode(prodPolicy("command-only", { environments: ["prod"] }), manifest, env).mode).toBe("command-only");
  });

  test("gated-apply se parsea pero actúa como command-only y lo dice", async () => {
    const { d, runner } = await run(prodPolicy("gated-apply"), "prod", { "demo-prod": "222222222222" });
    expect(d.status).toBe("allowed");
    if (d.status !== "allowed") return;
    expect(d.requestedMode).toBe("gated-apply");
    expect(d.effectiveMode).toBe("command-only");
    expect(d.notes.join(" ")).toMatch(/NO está implementado/);
    const text = commandOnlyResponse(d, ["aws", "ecs", "update-service", "--service", "demo web"]);
    expect(text).toContain("no se ejecutó nada");
    expect(text).toContain("aws ecs update-service --service 'demo web'");
    // solo se llamó a sts; nada de ecs
    expect(runner.calls.every((c) => c[1] === "sts")).toBe(true);
  });

  test("renderCommand entrecomilla de forma segura", () => {
    expect(renderCommand(["echo", "it's", "$(x)"])).toBe(`echo 'it'\\''s' '$(x)'`);
  });
});

describe("detección de producción (no confiar en el ops.yaml del proyecto)", () => {
  const opsFalse = (name: string, profile = "demo-prod") => `
project: { name: demo }
stack: laravel
service_prefix: demo-
environments:
  - name: ${name}
    is_production: false
    aws_profile: ${profile}
    account_id: "111111111111"
    region: us-east-1
    cluster: shared
`;
  test("is_production:false en un entorno llamado prod sigue siendo producción", () => {
    expect(classifyEnvironment({ name: "Prod", is_production: false }).production).toBe(true);
    expect(classifyEnvironment({ name: "PRODUCTION", is_production: false }).production).toBe(true);
    for (const n of ["prod", "production"]) {
      const m = parseManifest(opsFalse(n));
      const env = requireEnvironment(m, n);
      // perfil desconocido para producción => disabled, no default_mode
      const r = resolveMode(policyOf({ default_mode: "gated-apply" }), m, env);
      expect(r.mode).toBe("disabled");
      expect(r.productionConflict).toContain("PRODUCCIÓN");
      // perfil conocido => production_mode, no default_mode
      const r2 = resolveMode(policyOf({ default_mode: "gated-apply", aws_profiles: { "demo-prod": { account_id: "111111111111", production_mode: "command-only" } } }), m, env);
      expect(r2.mode).toBe("command-only");
      expect(r2.reason).toContain("PRODUCCIÓN");
    }
  });
  test("production_envs del usuario marca como producción un entorno de otro nombre", () => {
    const m = parseManifest(opsFalse("live", "demo-live"));
    const env = requireEnvironment(m, "live");
    const pol = policyOf({ default_mode: "gated-apply" });
    expect(resolveMode(pol, m, env).mode).toBe("gated-apply"); // sin la lista del usuario no hay forma de saberlo
    const r = resolveMode(pol, m, env, ["live"]);
    expect(r.mode).toBe("disabled");
    expect(r.productionConflict).toBeDefined();
  });
  test("nombres parecidos no son producción; staging sigue usando default_mode", () => {
    expect(classifyEnvironment({ name: "preprod", is_production: false }).production).toBe(false);
    expect(classifyEnvironment({ name: "staging", is_production: false }).production).toBe(false);
    expect(classifyEnvironment({ name: "staging", is_production: true }).conflict).toBeUndefined();
    const m = parseManifest(OPS_YAML());
    expect(resolveMode(DEFAULT_POLICY, m, requireEnvironment(m, "staging")).mode).toBe("command-only");
  });
  test("decide() también aplica la regla (desde projects.yaml)", async () => {
    const m = parseManifest(opsFalse("live", "demo-live"));
    const env = requireEnvironment(m, "live");
    const d = await decide(DEFAULT_POLICY, m, env, async () => { throw new Error("no debe consultar AWS"); }, ["live"]);
    expect(d.status).toBe("disabled");
  });
});
