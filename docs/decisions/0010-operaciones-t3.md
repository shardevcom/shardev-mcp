# 0010 - Operaciones T3 (cambios en AWS): base de confirmación

Fecha: 2026-11-01. Este documento se amplía con cada PR de la serie; hoy cubre solo la confirmación humana (BASE-02).

## Principio

El servidor MCP nunca ejecuta un cambio en AWS: solo devuelve el comando `shardev` exacto. Lo ejecuta una persona por la CLI, que pide confirmación antes de cambiar nada. Las ejecuciones por CLI quedan en `audit.jsonl` con `source: "cli"` (ADJ-09).

## Confirmación humana (`src/core/confirm.ts`)

`confirmHuman(io, { summary, phrase })` devuelve `confirmed`, `no_tty`, `mismatch` o `eof`.

- Exige stdin y stderr como TTY real. Si no lo son, rechaza **sin leer** nada: una tubería (`echo frase | shardev ...`) no puede confirmar. stderr también debe ser TTY porque ahí se muestran el resumen y el prompt.
- Una sola lectura, sin reintentos; la frase debe coincidir exacta (distingue mayúsculas; solo se quita el fin de línea). EOF o Ctrl-D no confirman.
- No hay `--yes`, `--force` ni variable de entorno que lo eluda, tampoco `CI`.
- Resumen y prompt van a stderr: la salida `--json` por stdout sigue siendo exactamente el JSON de la herramienta.
- El resumen no se redacta dentro del helper: el llamador pasa líneas ya redactadas.
- `CliIo` gana `isTty?` y `readLine?` (inyectables en tests); si faltan se trata como no-TTY. La implementación real vive en `src/cli.ts`: lee una línea y suelta stdin para que el proceso pueda terminar.

## Límite conocido

La comprobación de TTY frena tuberías y agentes no interactivos, pero un proceso que reserve un pty (`script`, `expect`) puede simular un terminal. **No es una frontera de seguridad frente a un proceso local hostil.** La frontera real es que el MCP nunca ejecuta cambios más los avisos de permiso de Bash del cliente que lanza la CLI.

## Primera herramienta T3: `ops_redeploy` (BASE-01)

- **Catálogo:** `OPS_REDEPLOY`, tier T3, `usesAws: true`. Al registrarla con `annotationsForTier`/`metaForTier` (igual que el resto) expone `destructiveHint: true`, `readOnlyHint: false` y `_meta["anthropic/requiresUserInteraction"] = true`, que hace que el cliente pida confirmación en cada llamada.
- **El MCP no cambia nada.** Devuelve `decision: "command-only"`, `isError: false` y el texto de `commandOnlyResponse` con el comando `shardev ops redeploy --project P --env E (--service S | --all)` (comillas de `renderCommand`), precedido de qué afectaría (servicios, entorno, producción sí/no según `classifyEnvironment`). La única llamada a AWS es la de identidad de la política; no hay `ecs update-service` en la ruta MCP (hay test con runner falso). El comando de la CLI lo añade SVC-01.
- **Entrada:** esquema estricto (`project`, `env`, `service`, `all: true`; claves extra se rechazan). Exactamente uno de `service` o `all`; no hay objetivo por defecto. Ninguno o ambos = `rejected`. `service` debe estar declarado en `services` del entorno; `all` expande a todos los declarados. Los nombres pasan por el esquema y por el gate, así que una entrada como `x; rm -rf /` se rechaza y nunca aparece en un comando.
- **Gate compartido:** `gateChange` (`src/ops/change-gate.ts`) y `gateRead` comparten `evaluatePolicy` (política + identidad, en `read-gate.ts`). Orden: validación local -> política -> identidad. A diferencia de la lectura, el cambio conserva la decisión para devolver sus notas. `disabled`, `unavailable` (sin sesión) y `rejected` (cuenta distinta, entrada inválida, capacidad ausente) no devuelven ningún comando.
- **`gated-apply`:** sigue comportándose como `command-only`; la nota de `decide` lo dice.
- **Auditoría:** el envoltorio existente registra `tool: ops_redeploy`, `tier: T3`, `decision`, `source: mcp`.

## `shardev ops redeploy` (SVC-01): el primer cambio real

Flujo, en este orden:

1. `gateChange`: la misma validación, política e identidad que la herramienta MCP. `disabled`, `unavailable` y `rejected` terminan sin prompt y sin llamar a ECS. `command-only` significa que lo ejecuta una persona, así que la CLI sigue; `gated-apply` pide la misma confirmación.
2. `confirmHuman` con un resumen redactado en stderr (proyecto, entorno, **PRODUCCIÓN sí/no**, cuenta, perfil, región, cluster, servicios y efecto) y la frase `<proyecto>/<entorno>`. `no_tty`, `mismatch` y `eof` no cambian nada: exit 1, decisión `rejected`. Un solo intento.
3. **Auditoría de intención antes de cambiar** (`phase: "intent"`, `exit_code: null`, decisión `allowed`). **T3 falla cerrado**: si esta escritura falla, no se toca AWS y se sale con 1. Es deliberadamente más estricto que las lecturas, donde un fallo de auditoría solo avisa.
4. Por servicio, en secuencia: `aws ecs update-service --cluster C --service S --force-new-deployment --profile P --region R --output json --no-cli-pager` como array por `ctx.runner`, a través de `src/core/aws-change.ts`, que tiene su propia lista cerrada (solo `ecs update-service`). La respuesta se filtra a campos conocidos (id del despliegue PRIMARY); nunca se reenvía la salida cruda ni `overrides`, y stderr se redacta y recorta.
5. **Se detiene en el primer fallo; no hay rollback.** Estados por servicio: `done`, `failed`, `unknown` (timeout: puede haberse aplicado; verificar con `shardev ops services`) y `not_attempted`. Sin sesión a mitad es un fallo con el comando de login. Exit 1 salvo que todos estén `done`.
6. Auditoría de resultado (`phase: "result"`, decisión `allowed` o `error`, exit code real), escrita por el envoltorio común de la CLI sin duplicar la de intención. Si la CLI rechaza la entrada (flag desconocido), solo queda la entrada de resultado `rejected`.

**"Iniciado", nunca "completado":** `update-service` volviendo significa que el despliegue se lanzó, no que terminó. El resultado sugiere `shardev ops services` para seguirlo. No hay `--wait` en esta versión.

**Sin atajos:** no existe `--yes`/`--force`; este subcomando rechaza cualquier flag fuera de `project`, `env`, `service`, `all` y `json` (el resto de la CLI ignora flags desconocidos). `--json` deja en stdout solo el JSON del resultado; resumen y prompt van a stderr.

**Garantía estructural:** el handler MCP (`src/ops/redeploy.ts`) sigue siendo command-only. El ejecutor (`src/ops/redeploy-exec.ts` y `src/core/aws-change.ts`) solo se importa desde `src/cli-run.ts`; un test recorre el grafo de imports desde `src/server.ts` y comprueba que no son alcanzables.
