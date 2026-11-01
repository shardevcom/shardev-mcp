# 0001 - Spikes de la fase 1

Fecha: 2026-11-01. Host: Node 24.13.1, Claude Code 2.1.316. Todo lo marcado VERIFIED se ejecutó aquí; lo demás es UNVERIFIED.
Scripts en `spikes/` (servidor y cliente mínimos).

## 1. Qué paquete del SDK funciona con Claude Code 2.1.316 por stdio

Resultado: **ambos funcionan**. Decisión: `@modelcontextprotocol/sdk@1.32.2` (conservadora: un solo paquete, API estable `McpServer.registerTool`, `server.elicitInput`).

- VERIFIED `@modelcontextprotocol/sdk` 1.32.2: servidor mínimo (`spikes/sdk-server.mjs`) probado con el cliente del SDK (`spikes/sdk-client.mjs`: `listTools`, `callTool`, `_meta` y `annotations` llegan intactos) y con `claude -p --model haiku --strict-mcp-config --mcp-config <archivo> --allowedTools mcp__spike__ping --max-turns 3`: el modelo devolvió `pong`.
- VERIFIED `@modelcontextprotocol/server` + `client` 2.4.0 (probados en un directorio temporal fuera del repo): cliente 2.4.0 contra servidor 2.4.0 y `claude -p` con la misma forma de comando devolvió `pong-v2`. API distinta: `inputSchema` se pasa como `z.object(...)`, `StdioServerTransport` sale de `@modelcontextprotocol/server/stdio`.
- Por qué 1.x: la versión 2.x es una reescritura (protocolo 2026-07-28); funciona hoy, pero no aporta nada que esta fase necesite. La migración es posible y localizada en `src/server.ts`. UNVERIFIED: cuál de las dos línea recibirá soporte a más largo plazo.
- Se usaron 3 ejecuciones de `claude -p` en total (1 ping v1, 1 ping_interactive v1, 1 ping v2).

## 2. Dónde va `anthropic/requiresUserInteraction`

- Fuente (https://code.claude.com/docs/en/mcp, sección "Require approval for a specific tool"): va en **`_meta`** de la entrada de `tools/list`, no en `annotations`: `"_meta": {"anthropic/requiresUserInteraction": true}`. El valor debe ser el booleano JSON `true`; cualquier otro se ignora. Con él Claude Code pide permiso en cada llamada, incluso en `acceptEdits`/`auto`/`bypassPermissions`, no ofrece "no volver a preguntar", y las reglas allow no lo saltan. En `dontAsk` deniega.
- `readOnlyHint` e `idempotentHint` sí van en `annotations` (Claude Code los usa para paralelizar lecturas y reintentar).
- VERIFIED que el SDK 1.32.2 (`registerTool({ _meta })`) lo emite y el cliente lo recibe en `tools[].\_meta`.
- VERIFIED bajo `claude -p`: con `--allowedTools mcp__spike__ping_interactive` la llamada **falló** con `MCPTool requires permission.`; el modelo no pudo ejecutar la herramienta. Es decir, en modo no interactivo las herramientas marcadas quedan bloqueadas aunque estén en la allowlist (comportamiento seguro).
- UNVERIFIED (requiere persona): que en sesión interactiva aparezca el prompt en cada llamada y que "Always allow" no se ofrezca. Pasos manuales:
  1. Desde la raíz del repositorio: `claude --strict-mcp-config --mcp-config spikes/mcp.example.json` (archivo de ejemplo del repo; su ruta al servidor es relativa al directorio de trabajo, así que se ejecuta desde la raíz del repositorio).
  2. Pedir: "llama a la herramienta ping_interactive". Debe aparecer un diálogo de permiso. Anotar si ofrece opción "don't ask again" (no debería).
  3. Aprobar; debe responder `pong-interactive`. Repetir la petición: debe preguntar de nuevo.
  4. Pulsar Shift+Tab hasta modo `auto` o `bypassPermissions` y repetir: debe seguir preguntando.
  5. Llamar a `ping` (sin marca): no debe preguntar si está en allow, o preguntar normal si no.

## 3. Elicitation

- API (SDK 1.32.2): `server.server.elicitInput({ message, requestedSchema })` (modo form) o `{ mode: "url", ... }`; devuelve `{ action: "accept" | "decline" | "cancel", content? }`. El servidor puede leer lo que el cliente declaró con `server.server.getClientCapabilities()?.elicitation`.
- Documentación de Claude Code: soporta elicitation automáticamente (form y URL), sin configuración. Declara `elicitation: {form:{}, url:{}}` en stdio con Claude Code >= 2.1.287 (2.1.316 cumple). Hay un hook `Elicitation` para auto-responder sin diálogo.
- VERIFIED (con el cliente del SDK, no con Claude Code): el roundtrip form funciona: el cliente declaró `elicitation.form`, el servidor lo vio y recibió `{action:"accept",content:{ok:true}}`.
- UNVERIFIED: el comportamiento real en Claude Code (diálogo interactivo) y bajo `claude -p` (la documentación solo indica el hook; no se gastó una ejecución). Pasos manuales:
  1. Con el mismo `--mcp-config` de arriba, sesión interactiva: "llama a elicit_demo con what=prueba".
  2. Debe aparecer un diálogo con un checkbox "Confirmo". Aceptar: el resultado debe incluir `"action":"accept"` y, en `caps`, `elicitation` con `form` y `url`.
  3. Repetir y declinar/cancelar: debe volver `action: decline|cancel`.
  4. Opcional, `claude -p ... "llama a elicit_demo"`: anotar si falla, expira o se auto-cancela.
- Consecuencia de diseño: la fase 3 NO debe depender de elicitation como única barrera; `_meta` requiresUserInteraction es el mecanismo con comportamiento documentado.

## 4. `aws ecs execute-command --interactive` sin TTY

- UNVERIFIED: no se ejecutó contra AWS (los spikes no tocan infraestructura real). La sesión usa Session Manager plugin y exige TTY real para un shell interactivo; es esperable que falle o quede colgada desde un proceso MCP con stdin cerrado, pero no está comprobado.
- Alternativa para la fase siguiente: `aws ecs run-task` (override de `command` sobre la task definition del servicio, mismo cluster/red) y leer la salida de CloudWatch Logs con `aws logs get-log-events` / `aws logs tail` (sin `--follow`), esperando con `aws ecs wait tasks-stopped` y leyendo el `exitCode` con `describe-tasks`. Toda tarea one-off debe ser T2/T3 según el entorno.

## TypeScript 7 y Vitest 5

- VERIFIED: `typescript@7.0.2` compila (`tsc --noEmit`, `module/moduleResolution NodeNext`, `strict`) un archivo que importa `@modelcontextprotocol/sdk` 1.32.2 y zod 4.6.7; `vitest@5.0.5` ejecuta un test que importa ese código. No hizo falta caer a TypeScript 5.x.
- `vitest@5.0.5` exige Node `^22.12 || ^24 || >=26`; coherente con `engines >=22` (se recomienda >=22.12 en la práctica).
