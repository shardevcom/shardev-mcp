import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecResult, Runner } from "../../src/core/exec.js";
import type { Paths } from "../../src/core/paths.js";

const created: string[] = [];

export async function tempPaths(): Promise<Paths> {
  const root = await mkdtemp(join(tmpdir(), "shardev-mcp-test-"));
  created.push(root);
  const paths = { configDir: join(root, "config"), stateDir: join(root, "state") };
  await mkdir(paths.configDir, { recursive: true });
  return paths;
}

export async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "shardev-mcp-test-"));
  created.push(d);
  return d;
}

export async function cleanup(): Promise<void> {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
}

export const write = (path: string, text: string): Promise<void> => writeFile(path, text);

export const OPS_YAML = (extra = ""): string => `
project: { name: demo }
stack: laravel
service_prefix: demo-
capabilities: [ecs]
${extra}
environments:
  - name: staging
    is_production: false
    aws_profile: demo-stg
    account_id: "111111111111"
    region: us-east-1
    cluster: shared
  - name: prod
    is_production: true
    aws_profile: demo-prod
    account_id: "222222222222"
    region: us-east-1
    cluster: shared
`;

/** Igual que OPS_YAML pero con `capabilities` configurable y `services` por entorno (staging y prod comparten cluster y prefijo `demo-`). */
export const OPS_YAML_SERVICES = (capabilities = "[ecs, logs]"): string =>
  OPS_YAML()
    .replace("capabilities: [ecs]", `capabilities: ${capabilities}`)
    .replace("    cluster: shared\n  - name: prod", "    cluster: shared\n    services: [demo-staging-app, demo-staging-worker]\n  - name: prod")
    .replace(/    cluster: shared\n$/, "    cluster: shared\n    services: [demo-app, demo-worker]\n");

export async function registerDemoProject(paths: Paths, extraOps = "", yaml: string = OPS_YAML(extraOps)): Promise<string> {
  const dir = await tempDir();
  await writeFile(join(dir, "ops.yaml"), yaml);
  await writeFile(join(paths.configDir, "projects.yaml"), `projects:\n  demo:\n    path: ${dir}\n`);
  return dir;
}

const base: ExecResult = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1 };

/** Runner falso: nunca llama a AWS. Responde por cuenta según el perfil. */
export function fakeRunner(accounts: Record<string, string | "expired">): Runner & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = (async (cmd: string, args: readonly string[]) => {
    calls.push([cmd, ...args]);
    const profile = args[args.indexOf("--profile") + 1] ?? "";
    const acc = accounts[profile];
    if (acc === undefined) return { ...base, exitCode: 255, stderr: `The config profile (${profile}) could not be found` };
    if (acc === "expired") return { ...base, exitCode: 255, stderr: "Error when retrieving token from sso: Token has expired and refresh failed" };
    return { ...base, stdout: JSON.stringify({ UserId: "X", Account: acc, Arn: `arn:aws:iam::${acc}:user/test` }) };
  }) as Runner & { calls: string[][] };
  fn.calls = calls;
  return fn;
}
