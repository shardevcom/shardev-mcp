import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { auditFile } from "../src/core/paths.js";
import { createServer } from "../src/server.js";
import { awsRunner } from "./helpers/aws-fixtures.js";
import { OPS_YAML_SERVICES, cleanup, registerDemoProject, tempPaths, write } from "./helpers/fixtures.js";

afterEach(cleanup);

async function setup(accounts: Record<string, string | "expired"> = { "demo-stg": "111111111111", "demo-prod": "222222222222" }, yaml = OPS_YAML_SERVICES(), policy?: string) {
  const paths = await tempPaths();
  await registerDemoProject(paths, "", yaml);
  if (policy) await write(join(paths.configDir, "policy.yaml"), policy);
  const runner = awsRunner(accounts);
  const { server } = createServer({ paths, runner });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (args: Record<string, unknown>) => {
    const r = (await client.callTool({ name: "ops_redeploy", arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content[0]?.text ?? "", isError: r.isError === true };
  };
  const audit = async () => (await readFile(auditFile(paths), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  return { paths, runner, client, call, audit };
}

const PROD_POLICY = "aws_profiles:\n  demo-prod:\n    account_id: '222222222222'\n    production_mode: command-only\n";
const NO_COMMAND = (text: string) => expect(text).not.toContain("shardev ops redeploy");

describe("ops_redeploy (T3, solo devuelve el comando)", () => {
  test("el listado MCP expone anotaciones destructivas y requiresUserInteraction", async () => {
    const { client } = await setup();
    const t = (await client.listTools()).tools.find((x) => x.name === "ops_redeploy")!;
    expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(t._meta).toMatchObject({ "anthropic/requiresUserInteraction": true });
    expect((t.inputSchema as { required?: string[] }).required).toEqual(expect.arrayContaining(["project", "env"]));
  });

  test("staging con service: command-only, comando exacto, solo la llamada de identidad", async () => {
    const { call, runner, audit } = await setup();
    const r = await call({ project: "demo", env: "staging", service: "demo-staging-app" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("shardev ops redeploy --project demo --env staging --service demo-staging-app");
    expect(r.text).toContain("no se ejecutó nada");
    expect(r.text).toContain("producción: no");
    expect(runner.calls.length).toBeGreaterThan(0);
    expect(runner.calls.every((c) => c[1] === "sts" && c[2] === "get-caller-identity")).toBe(true);
    expect((await audit()).at(-1)).toMatchObject({ source: "mcp", tool: "ops_redeploy", tier: "T3", decision: "command-only", project: "demo", env: "staging" });
  });

  test("producción con all: command-only, indica producción y no llama a ECS", async () => {
    const { call, runner } = await setup(undefined, undefined, PROD_POLICY);
    const r = await call({ project: "demo", env: "prod", all: true });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("shardev ops redeploy --project demo --env prod --all");
    expect(r.text).toContain("producción: sí");
    expect(r.text).toContain("demo-app, demo-worker");
    expect(runner.calls.every((c) => c[1] === "sts")).toBe(true);
    expect(runner.reads).toHaveLength(0);
  });

  test("gated-apply pedido se comporta como command-only y la nota lo dice", async () => {
    const { call } = await setup(undefined, undefined, PROD_POLICY.replace("command-only", "gated-apply"));
    const r = await call({ project: "demo", env: "prod", service: "demo-app" });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("gated-apply NO está implementado");
    expect(r.text).toContain("--service demo-app");
  });

  test("objetivo: ninguno, ambos, all:false, servicio ajeno y extras se rechazan sin comando", async () => {
    const { call, runner, audit } = await setup();
    for (const extra of [{}, { service: "demo-staging-app", all: true }, { all: false }, { service: "demo-app" }, { service: "demo-staging-app", force: true }]) {
      const r = await call({ project: "demo", env: "staging", ...extra });
      expect(r.isError).toBe(true);
      NO_COMMAND(r.text);
    }
    expect((await audit()).at(-1)).toMatchObject({ tool: "ops_redeploy", tier: "T3", decision: "rejected" });
    expect(runner.calls).toHaveLength(0);
  });

  test("falta env o proyecto: rechazado sin comando", async () => {
    const { call } = await setup();
    NO_COMMAND((await call({ project: "demo", all: true })).text);
    expect((await call({ project: "demo", all: true })).isError).toBe(true);
    expect((await call({ env: "staging", all: true })).isError).toBe(true);
    expect((await call({ project: "nada", env: "staging", all: true })).isError).toBe(true);
  });

  test("entrada hostil nunca llega al texto como comando", async () => {
    const { call } = await setup();
    for (const args of [{ service: "x; rm -rf /" }, { service: "$(id)" }]) {
      const r = await call({ project: "demo", env: "staging", ...args });
      expect(r.isError).toBe(true);
      NO_COMMAND(r.text);
    }
    const r = await call({ project: "demo", env: "staging; rm -rf /", all: true });
    expect(r.isError).toBe(true);
    NO_COMMAND(r.text); // lo corta el esquema del MCP antes de llegar al gate
  });

  test("disabled (producción sin perfil en policy): sin comando", async () => {
    const { call, runner } = await setup();
    const r = await call({ project: "demo", env: "prod", all: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("deshabilitada");
    NO_COMMAND(r.text);
    expect(runner.calls).toHaveLength(0);
  });

  test("cuenta distinta: rechazado sin comando", async () => {
    const { call, audit } = await setup({ "demo-stg": "999999999999" });
    const r = await call({ project: "demo", env: "staging", all: true });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no coincide");
    NO_COMMAND(r.text);
    expect((await audit()).at(-1)).toMatchObject({ decision: "rejected" });
  });

  test("sin sesión: unavailable sin comando", async () => {
    const { call, audit } = await setup({ "demo-stg": "expired" });
    const r = await call({ project: "demo", env: "staging", all: true });
    expect(r.isError).toBe(true);
    NO_COMMAND(r.text);
    expect((await audit()).at(-1)).toMatchObject({ tier: "T3", decision: "unavailable" });
  });

  test("sin la capacidad ecs: rechazado sin comando", async () => {
    const { call } = await setup(undefined, OPS_YAML_SERVICES("[logs]"));
    const r = await call({ project: "demo", env: "staging", all: true });
    expect(r.isError).toBe(true);
    NO_COMMAND(r.text);
  });

  test("policy.yaml inválida: disabled sin comando", async () => {
    const { call } = await setup(undefined, undefined, "default_mode: nope\n");
    const r = await call({ project: "demo", env: "staging", all: true });
    expect(r.isError).toBe(true);
    NO_COMMAND(r.text);
  });
});
