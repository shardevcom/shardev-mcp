import { UNTRUSTED_NOTICE } from "../core/output.js";
import type { Ctx, ToolOutcome } from "./context.js";
import { asArray, asRecord, familyRevision, gateRead, isoTime, num, runRead, str } from "./read-gate.js";

export interface OpsServicesArgs {
  project?: string;
  env?: string;
  service?: string;
}
export interface OpsTasksArgs {
  project?: string;
  env?: string;
  service?: string;
  status?: string;
}

const MAX_TASKS = 20;
const SERVICE_BATCH = 10;
const TASK_ARN_RE = /^arn:aws[a-z-]*:ecs:[a-z0-9-]+:\d{12}:task\/[A-Za-z0-9_\/-]+$/;

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** `ecs describe-services` (lotes de 10) con una lista blanca de campos. */
export async function opsServices(ctx: Ctx, args: OpsServicesArgs): Promise<ToolOutcome> {
  const gate = await gateRead(ctx, args, "ecs", false);
  if (!gate.ok) return gate.outcome;
  const services: unknown[] = [];
  const failures: unknown[] = [];
  for (let i = 0; i < gate.services.length; i += SERVICE_BATCH) {
    const batch = gate.services.slice(i, i + SERVICE_BATCH);
    const r = await runRead(ctx, gate, "ecs describe-services", ["--cluster", gate.env.cluster, "--services", ...batch]);
    if (!r.ok) return r.outcome;
    const body = asRecord(r.json);
    for (const raw of asArray(body.services)) {
      const s = asRecord(raw);
      services.push({
        service: str(s.serviceName, 255),
        status: str(s.status, 40),
        desired: num(s.desiredCount),
        running: num(s.runningCount),
        pending: num(s.pendingCount),
        task_definition: familyRevision(s.taskDefinition),
        deployments: asArray(s.deployments).map((d) => {
          const x = asRecord(d);
          return {
            status: str(x.status, 40),
            rolloutState: str(x.rolloutState, 40),
            desired: num(x.desiredCount),
            running: num(x.runningCount),
            failed: num(x.failedTasks),
            updatedAt: isoTime(x.updatedAt),
          };
        }),
        events: asArray(s.events).slice(0, 5).map((ev) => {
          const x = asRecord(ev);
          return { createdAt: isoTime(x.createdAt), message: ctx.redactor.redact(str(x.message, 500) ?? "") };
        }),
      });
    }
    for (const raw of asArray(body.failures)) {
      const f = asRecord(raw);
      failures.push({ service: (str(f.arn, 400) ?? "").split("/").pop() ?? null, reason: str(f.reason, 100) });
    }
  }
  return {
    text: json({
      project: gate.project.name,
      env: gate.env.name,
      cluster: gate.env.cluster,
      policy: gate.policyNote,
      services,
      failures,
      untrusted_fields: ["services[].events[].message"],
      aviso: UNTRUSTED_NOTICE,
    }),
    isError: false,
    decision: "allowed",
    project: gate.project.name,
    env: gate.env.name,
  };
}

/** `ecs list-tasks` + `describe-tasks` de un servicio declarado (máx. 20), solo campos de la lista blanca. */
export async function opsTasks(ctx: Ctx, args: OpsTasksArgs): Promise<ToolOutcome> {
  const status = args.status ?? "RUNNING";
  if (status !== "RUNNING" && status !== "STOPPED") {
    return { text: "`status` debe ser RUNNING o STOPPED.", isError: true, decision: "rejected", project: args.project, env: args.env };
  }
  const gate = await gateRead(ctx, args, "ecs", true);
  if (!gate.ok) return gate.outcome;
  const service = gate.services[0]!;

  const listed = await runRead(ctx, gate, "ecs list-tasks", ["--cluster", gate.env.cluster, "--service-name", service, "--desired-status", status, "--max-items", String(MAX_TASKS)]);
  if (!listed.ok) return listed.outcome;
  const listBody = asRecord(listed.json);
  const allArns = asArray(listBody.taskArns).filter((a): a is string => typeof a === "string");
  const arns = allArns.slice(0, MAX_TASKS);
  if (arns.some((a) => !TASK_ARN_RE.test(a))) {
    return { text: "aws ecs list-tasks devolvió un identificador de tarea inesperado; no se continúa.", isError: true, decision: "error", project: gate.project.name, env: gate.env.name };
  }
  const truncated = allArns.length > MAX_TASKS || listBody.NextToken !== undefined && listBody.NextToken !== null;

  const tasks: unknown[] = [];
  if (arns.length > 0) {
    const d = await runRead(ctx, gate, "ecs describe-tasks", ["--cluster", gate.env.cluster, "--tasks", ...arns]);
    if (!d.ok) return d.outcome;
    for (const raw of asArray(asRecord(d.json).tasks).slice(0, MAX_TASKS)) {
      const t = asRecord(raw);
      tasks.push({
        task: (str(t.taskArn, 400) ?? "").split("/").pop() || null,
        lastStatus: str(t.lastStatus, 40),
        desiredStatus: str(t.desiredStatus, 40),
        task_definition: familyRevision(t.taskDefinitionArn),
        startedAt: isoTime(t.startedAt),
        stoppedAt: isoTime(t.stoppedAt),
        stopCode: str(t.stopCode, 60),
        stoppedReason: t.stoppedReason === undefined ? null : ctx.redactor.redact(str(t.stoppedReason, 500) ?? ""),
        containers: asArray(t.containers).map((c) => {
          const x = asRecord(c);
          return {
            name: str(x.name, 255),
            lastStatus: str(x.lastStatus, 40),
            exitCode: num(x.exitCode),
            reason: x.reason === undefined ? null : ctx.redactor.redact(str(x.reason, 500) ?? ""),
          };
        }),
      });
    }
  }
  return {
    text: json({
      project: gate.project.name,
      env: gate.env.name,
      service,
      status,
      policy: gate.policyNote,
      max_tasks: MAX_TASKS,
      truncated,
      tasks,
      untrusted_fields: ["tasks[].stoppedReason", "tasks[].containers[].reason"],
      aviso: UNTRUSTED_NOTICE,
    }),
    isError: false,
    decision: "allowed",
    project: gate.project.name,
    env: gate.env.name,
  };
}

