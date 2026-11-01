export type ErrorCode =
  | "invalid_input"
  | "unregistered_project"
  | "invalid_manifest"
  | "invalid_policy"
  | "env_required"
  | "unknown_environment"
  | "foreign_service"
  | "services_not_declared"
  | "capability_missing"
  | "invalid_log_ref"
  | "log_not_found"
  | "exec_failed"
  | "invalid_spec"
  | "invalid_template"
  | "invalid_layer"
  | "wiring_failed"
  | "invalid_plan"
  | "plan_expired"
  | "plan_tampered"
  | "plan_stale"
  | "invalid_config"
  | "target_not_allowed"
  | "target_not_free"
  | "repo_not_clean"
  | "not_shardev_project"
  | "apply_failed";

/** Error esperado y seguro de mostrar al usuario (el mensaje nunca lleva secretos). */
export class ShardevError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ShardevError";
    this.code = code;
  }
}
