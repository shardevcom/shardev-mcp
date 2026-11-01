# @shardev/cli

Servidor MCP (stdio) y CLI (`shardev`) para crear y operar proyectos Laravel + React + AWS ECS, pensado para reemplazar scripts de shell. Solo ESM, Node >= 22.

**Estado: núcleo del generador y lecturas AWS.** Cinco herramientas de lectura (T0/T1: `ops_status`, `ops_services`, `ops_tasks`, `ops_logs`, `log_read`) y cinco de generación local (T2, sin AWS). Pendientes (no existen todavía): `mobile_add`, las herramientas `ui_*` y cualquier operación que cambie AWS.

| Herramienta | Tier | Qué hace |
|---|---|---|
| `ops_status` | T1 | Lista proyectos registrados; con `project` (y opcionalmente `env`) muestra perfil AWS, identidad (`aws sts get-caller-identity`) y política efectiva por entorno. |
| `ops_services` | T1 | Estado de los servicios ECS declarados del entorno (`ecs describe-services`): estado, conteos, task definition (`familia:revisión`), despliegues y últimos 5 eventos (texto no confiable). `project` y `env` obligatorios; `service` opcional (omitido = todos los de `services`). Requiere la capacidad `ecs`. |
| `ops_tasks` | T1 | Hasta 20 tareas `RUNNING` (por defecto) o `STOPPED` de un servicio declarado (`list-tasks` + `describe-tasks`): id corto, estados, horas, `stopCode`/`stoppedReason` y contenedores (nombre, estado, `exitCode`, `reason`). Lista blanca de campos: nunca `overrides` ni variables de entorno. Requiere `ecs`. |
| `ops_logs` | T1 | Busca en el grupo `/ecs/<servicio>` (`logs filter-log-events`; `since_minutes` 1-1440, por defecto 60; `limit` 1-1000, por defecto 200; `filter` literal de hasta 200 caracteres). **No devuelve el contenido**: lo guarda redactado y devuelve conteo, `truncated`, primer/último timestamp y `log_ref` para `log_read`. Devuelve los eventos **más recientes** de la ventana (los `limit` últimos, ascendentes en el archivo guardado). Borra los logs de esta herramienta con más de 7 días. Requiere `logs`. |
| `log_read` | T0 | Lee/filtra (grep literal) un log guardado, solo por referencia. El contenido se devuelve marcado como dato no confiable. |
| `project_plan` | T2 | Planifica un proyecto **nuevo** a partir de un spec: archivos, diffs de edits, comandos de verificación, conflictos y `plan_id` (30 min). No escribe el proyecto. |
| `project_create` | T2 | Aplica un `plan_id` (nunca un spec): genera en un temporal junto al destino, verifica y renombra atómicamente. |
| `project_verify` | T2 | Re-verifica un proyecto generado y registrado (pasos de las plantillas + escaneo de secretos). |
| `app_plan` | T2 | Planifica añadir una app frontend a un proyecto ya generado (`project_path` bajo `allowed_roots` con `.ops/lock.yaml`): `key`, `user_type` (`new`\|`existing`), `provider`, `table`, `model`, `api_guard`, `session_guard`, `port`, `build_dir` (todos derivados de la `key` si faltan) `features` (`otp`, `social`, `mfa`, `invitations`; `mfa` no se combina con `otp` ni `social`, `invitations` no se combina con `auto_register`), `social_providers` (`google`, `microsoft`, `apple`) y `auto_register` (por defecto `false`). Devuelve archivos, diffs de edits, conflictos, notas y un `plan_id` (30 min) atado al estado de los archivos que toca. No escribe el proyecto. |
| `app_create` | T2 | Aplica un `plan_id` de `app_plan` (nunca datos de la app): solo capas de app y edits por ancla; si algo falla restaura y borra todo. Ver `docs/decisions/0004-app-create.md`. |

`templates/` contiene las capas base (laravel, workspace, packages, app-model, app-auth, tests-auth, app-react, app-workspace, env, docker, claude-kit, verify, y las opcionales app-otp, app-social, app-mfa, mfa-deps, app-invitations, tests-otp, tests-social, tests-mfa, tests-invitations, app-react-otp, app-react-social, app-react-mfa, app-react-invitations); ver `docs/decisions/0003-plantillas.md`. `project_create` solo corre pasos ligeros; `project_verify` corre además composer, migraciones, tests, pnpm, build y `docker compose config`. `app_plan`/`app_create` añaden una app a un proyecto ya generado sin re-renderizar nada de proyecto (los feature layers `otp`, `social`, `mfa` e `invitations` existen, ver `docs/decisions/0005-otp-social.md` y `docs/decisions/0006-mfa-invitations.md`).

## Instalación

Requiere Node >= 22.

```bash
npm install -g @shardev/cli      # instala el binario `shardev`
# o, sin instalar: npx @shardev/cli --version
```

Registrar el servidor en Claude Code (lo ejecutas tú; el paquete no toca tu configuración):

```bash
claude mcp add --scope user shardev -- shardev mcp serve
# sin instalación global: claude mcp add --scope user shardev -- npx -y @shardev/cli mcp serve
```

Para evitar prompts en las herramientas de solo lectura, permite `mcp__shardev__ops_status`, `mcp__shardev__ops_services`, `mcp__shardev__ops_tasks`, `mcp__shardev__ops_logs` y `mcp__shardev__log_read` en tus permisos. Las herramientas futuras de producción (T3) llevarán `_meta["anthropic/requiresUserInteraction"] = true` y pedirán confirmación en cada llamada (ver `docs/decisions/0001-spikes.md`).

Prueba rápida: `shardev --version`. La CLI es un solo binario: `shardev mcp serve` inicia el servidor y `shardev project plan|create|verify [--json]` `shardev app plan|create [--json]` ejecutan las mismas funciones que las herramientas `project_*` y `app_*`, y `shardev ops status|services|tasks|logs` las de `ops_*` (solo lectura; `--project`, `--env`, `--service`, `--status`, `--since-minutes`, `--filter`, `--limit`, `--json`; `--env` es obligatorio en services/tasks/logs; sale con código 1 si falla). Ejemplo: `shardev ops logs --project demo --env staging --service demo-staging-app --since-minutes 30 --filter ERROR`. Ejemplo: `shardev app plan --project-path ~/projects/acme --key supp --user-type new --json` y luego `shardev app create --plan-id plan_...`.

### Para contribuir

```bash
git clone https://github.com/shardevcom/shardev-mcp.git
cd shardev-mcp
npm install && npm run build
npm link   # opcional: expone el binario `shardev` desde tu copia local
```

## Configuración inicial del dueño

Solo se documentan los pasos; nada de esto lo ejecuta el paquete por ti.

1. **Crear la configuración** en `~/.config/shardev-mcp/` (ninguna herramienta la escribe):
   - `config.yaml`: `allowed_roots: [/home/yo/projects]`. Sin esto `project_create` no crea nada. Opcionalmente `leftover_terms` (ver más abajo).
   - `policy.yaml`: modo por perfil AWS (`default_mode`, `aws_profiles` con `account_id`, `production_mode`, `environments`). Sin archivo todo es `command-only`; producción con un perfil no listado queda `disabled`. Ver `examples/policy.yaml`.
   - `projects.yaml`: proyectos registrados (`path` absoluto y `production_envs` opcional). Ver `examples/projects.yaml`.
2. **`ops.yaml` en la raíz de cada proyecto** (nombre, `service_prefix`, `capabilities`, y por entorno `is_production`, `aws_profile`, `account_id`, `region`, `cluster`). Ver `examples/ops.yaml`.
3. Inicia sesión AWS tú mismo (`aws sso login --profile X`); el servidor nunca lo hace.

## Archivos de configuración

Todo vive en `~/.config/shardev-mcp/` (config del dueño) y `~/.local/state/shardev-mcp/` (estado). Las rutas no se pueden cambiar por variables de entorno, a propósito: un `.mcp.json` de proyecto no debe poder apuntar a otra política.

### `~/.config/shardev-mcp/policy.yaml`

Política del dueño, fuera de cualquier proyecto; **ninguna herramienta puede escribirla**. Ejemplo comentado en `examples/policy.yaml`:

```yaml
default_mode: command-only        # entornos no productivos
aws_profiles:
  mi-perfil-prod:
    account_id: "222222222222"
    production_mode: command-only
    environments: [prod]          # opcional
```

- Modos (de menos a más permisivo): `disabled < command-only < gated-apply`. Sin archivo: `command-only`.
- Modo efectivo = el más restrictivo entre la regla del usuario y `policy.max_mode` del `ops.yaml` (el proyecto solo restringe).
- Producción con un perfil que no está en `aws_profiles` => `disabled` (fail closed). `policy.yaml` inválido => todo `disabled`.
- Sin sesión AWS => "operaciones AWS no disponibles" con el comando exacto (`aws sso login --profile X`); el servidor nunca intenta iniciar sesión.
- Cuenta autenticada distinta de la de `ops.yaml` (o de la del perfil en la policy) => rechazo.
- `command-only`: los **cambios** no se ejecutan (se devuelve el comando exacto para que lo ejecutes tú). No bloquea las lecturas fijas de solo lectura `ops_services`, `ops_tasks` y `ops_logs`, que corren también en producción. `disabled`, sin sesión y cuenta distinta siguen bloqueando todo antes de llamar a ECS/CloudWatch.
- `gated-apply`: se lee, pero **no está implementado**; actúa como `command-only` y lo indica en el resultado.

### `<proyecto>/ops.yaml`

Ejemplo en `examples/ops.yaml`:

```yaml
project: { name: demo }
stack: laravel
service_prefix: demo-
capabilities: [ecs, logs]
policy: { max_mode: command-only }   # opcional
environments:
  - name: staging
    is_production: false
    aws_profile: demo-stg
    account_id: "111111111111"
    region: us-east-1
    cluster: shared
    services: [demo-staging-app, demo-staging-worker]   # opcional, requerido por las lecturas ECS/logs
```

`env` nunca tiene valor por defecto. `is_production` es obligatorio. Los servicios ECS deben empezar por `service_prefix` (el cluster es compartido entre proyectos). Con cluster y cuenta compartidos un prefijo no separa entornos (el `demo-` de producción también cubre `demo-staging-app`), así que `ops_services`, `ops_tasks` y `ops_logs` solo operan sobre servicios que empiecen por el prefijo **y** estén listados exactamente en `services` de ese entorno; sin `services` fallan cerrado (no hay descubrimiento con `list-services`). `capabilities` se aplica: `ecs` para `ops_services`/`ops_tasks`, `logs` para `ops_logs`. Los logs de un servicio se leen del grupo `/ecs/<servicio>` (convención fija). Ver `docs/decisions/0007-ops-lectura-aws.md`.

**Compatibilidad al actualizar:** el esquema de entornos es estricto, así que una versión anterior de `shardev` rechaza un `ops.yaml` con `services` (`Unrecognized key`). Actualiza el CLI **antes** de añadir `services`.

### `~/.config/shardev-mcp/projects.yaml`

```yaml
projects:
  demo:
    path: /ruta/absoluta/al/proyecto/demo
    production_envs: [prod]   # opcional
```

**Producción** (la política no confía en el `ops.yaml` del proyecto, que un agente puede editar): un entorno es producción si el manifest dice `is_production: true`, **o** su nombre es `prod`/`production` (sin distinguir mayúsculas), **o** está en `production_envs` de este archivo. Gana producción ante cualquier conflicto y el resultado lo indica (`production_conflict`). El `account_id` no sirve para distinguir: staging y producción comparten cuenta.

Las herramientas reciben el nombre registrado, nunca una ruta libre.

### `~/.config/shardev-mcp/config.yaml`

```yaml
allowed_roots:            # sin esto, project_create no crea nada
  - /home/yo/projects
leftover_terms:           # opcional: restos que no deben llegar a un proyecto generado
  - acme-legacy
```

`leftover_terms` es una lista de términos (mínimo 2 caracteres) que el escaneo de restos busca en lo que se genera: coincidencia literal (los caracteres especiales de regex no se interpretan) y sin distinguir mayúsculas. Sirve para nombres de proyectos o dominios de origen que no deben quedar en un proyecto nuevo. Un término contenido en el nombre o dominio del propio proyecto no cuenta. Aplica a `project_create`, `project_verify` y `app_plan`/`app_create`; no forma parte del plan, que sigue siendo determinista. Independientemente de esta lista, el escaneo siempre rechaza ARN y registros ECR con un id de cuenta AWS de 12 dígitos. Ver `examples/config.yaml`.

El destino de `project_plan`/`project_create` y el `project_path` de `app_plan` deben quedar **estrictamente dentro** de una raíz (se resuelven symlinks y `..`).

## Generador

- **Spec** (`src/gen/spec.ts`, zod): `ProjectSpec { name, domain, apps[], features[], mobile? }`; cada app deriva guards, tabla, provider, modelo y `build_dir` de `key` (todo sobrescribible). Nombres estrictos (sin separadores de ruta); se rechazan duplicados de key, guard, tabla, puerto y `build_dir`.
- **Capas** (`templates/<capa>/layer.yaml`): `scope` (project|app|mobile), `order`, `when`, `requires` (variables que deben usarse), `files` (`src` o `tree`; `render` lista lo que se renderiza en un `tree`), `edits` (`json-merge`, `yaml-append`, `insert` anclado) y `verify` (`full: true` = solo `project_verify`). `{{ secret.app_key }}` etc. se rellenan con valores aleatorios al crear (archivo 0600, fuera del lock). Renderer propio: `{{ var }}` y `{{#if x}}`; estricto (variable desconocida, requerida sin usar o bloque sin cerrar = error); `$VAR`, `${VAR}`, `${{ }}` y variables de nginx pasan intactos; `\{{` emite un `{{` literal.
- **Cableado**: ancla ausente o ambigua = error; reaplicar un edit ya presente es no-op.
- **Plan** puro; se guarda en `~/.local/state/shardev-mcp/plans` (0600) con spec, hash de plantillas y hash del destino, firmado con HMAC (clave en `plan.key`, 0600). Un plan expirado, alterado, con plantillas distintas o con destino cambiado se rechaza. Un plan con conflictos no recibe `plan_id`.
- **Aplicar a repo existente**: árbol limpio, rama base distinta de `master`/`main`, rama nueva derivada del plan (`shardev/<label>-<proyecto>-<id8>`); sin commit, sin push, sin migraciones; si la verificación falla se revierte y se borra la rama.
- **Lock** `.ops/lock.yaml`: hash de plantillas, capas, spec y hash de cada archivo generado. **Verify**: pasos por `exec` (array, stdin cerrado, env explícito, timeout) y escaneo de secretos con los patrones del Redactor (una línea con `shardev-allow-secret` se omite). Decisiones en `docs/decisions/0002-generador.md`.

## Seguridad del motor

- `exec`: solo arrays de argumentos (sin shell), timeout, entorno explícito (PATH, HOME, AWS_PROFILE, AWS_REGION, AWS_DEFAULT_REGION, AWS_CONFIG_FILE, AWS_SHARED_CREDENTIALS_FILE + adiciones por llamada) y stdin cerrado.
- `redact`: enmascara formas conocidas de secretos (sk-ant-, AIza, GOCSPX-, AKIA, tokens de GitHub, JWT, Bearer, claves privadas), `NOMBRE=valor` con nombre de apariencia secreta (incluidas comillas: `export X_TOKEN="a b"`) `nombre: valor` (YAML y logs, con o sin comillas) con nombre de apariencia secreta, credenciales en URLs (`mysql://user:[REDACTED]@host`, se conservan usuario y host) y literales registrados. Limitaciones: es heurístico y prefiere enmascarar de más; no detecta secretos sin forma conocida ni nombre sospechoso (p. ej. un valor suelto en una línea sola), valores multilínea de YAML (`|`, `>`) ni secretos codificados/partidos.
- Logs completos (ya redactados) en `~/.local/state/shardev-mcp/logs` (dir 0700, archivos 0600); los resultados solo llevan resumen, exit code y `log_ref`. `log_read` rechaza cualquier referencia que no sea un nombre de archivo generado (sin `/`, `..`, ni symlinks).
- Lecturas AWS: solo `ecs describe-services`, `ecs list-tasks`, `ecs describe-tasks` y `logs filter-log-events` (más `sts get-caller-identity`), siempre como array de argumentos con `--profile`, `--region`, `--output json` y `--no-cli-pager`; el contenido de logs nunca vuelve en el resultado.
- Auditoría append-only en `~/.local/state/shardev-mcp/audit.jsonl` (tool, proyecto, env, tier, decisión, exit code, duración; argumentos redactados).
- stdout es el canal del protocolo; los logs del servidor van a stderr.

## Desarrollo

```bash
npm run typecheck
npm test            # rápido: sin red
npm run test:slow   # genera un proyecto real y corre composer/pnpm/build (red, ~70 s)
npm run build
```

Los tests usan directorios temporales y un runner falso de `aws`; nunca tocan el HOME real ni AWS. Las decisiones de diseño están en el repositorio (`docs/decisions/`; no se publican en el paquete npm).
