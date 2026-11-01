import type { ExecResult, Runner } from "../../src/core/exec.js";
import { fakeRunner } from "./fixtures.js";

const base: ExecResult = { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1 };

export type AwsResponder = (args: readonly string[]) => Partial<ExecResult> | object;

/**
 * Runner falso de `aws`: `sts` lo resuelve fakeRunner (por cuenta/perfil); el resto se despacha por
 * "servicio operación" a un responder. Un objeto se serializa como stdout; un Partial<ExecResult> se usa tal cual.
 * Nunca llama a AWS.
 */
export function awsRunner(accounts: Record<string, string | "expired">, responders: Record<string, AwsResponder> = {}): Runner & { calls: string[][]; reads: string[][] } {
  const sts = fakeRunner(accounts);
  const calls: string[][] = [];
  const reads: string[][] = [];
  const fn = (async (cmd: string, args: readonly string[], opts?: never) => {
    calls.push([cmd, ...args]);
    const op = `${args[0]} ${args[1]}`;
    if (op === "sts get-caller-identity") return sts(cmd, args, opts);
    reads.push([cmd, ...args]);
    const responder = responders[op];
    if (!responder) return { ...base, exitCode: 254, stderr: `no hay responder para ${op}` };
    const r = responder(args) as Record<string, unknown>;
    if ("exitCode" in r || "stdout" in r || "stderr" in r || "timedOut" in r || "spawnError" in r) return { ...base, ...r } as ExecResult;
    return { ...base, stdout: JSON.stringify(r) };
  }) as Runner & { calls: string[][]; reads: string[][] };
  fn.calls = calls;
  fn.reads = reads;
  return fn;
}

export const argAfter = (args: readonly string[], flag: string): string | undefined => args[args.indexOf(flag) + 1];

/**
 * Simula `logs filter-log-events`: eventos ordenados ascendentes, respeta --start-time/--end-time (inclusivos)
 * y --max-items (devuelve el PRINCIPIO del rango y NextToken si había más), como la API real.
 */
export function cwLogs(all: ReadonlyArray<{ timestamp: number; message: string }>): AwsResponder {
  const sorted = [...all].sort((a, b) => a.timestamp - b.timestamp);
  return (args) => {
    const s = Number(argAfter(args, "--start-time"));
    const e = Number(argAfter(args, "--end-time"));
    const cap = Number(argAfter(args, "--max-items"));
    const inRange = sorted.filter((ev) => ev.timestamp >= s && ev.timestamp <= e);
    return { events: inRange.slice(0, cap), ...(inRange.length > cap ? { NextToken: "tok" } : {}) };
  };
}
