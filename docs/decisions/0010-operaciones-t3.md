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
