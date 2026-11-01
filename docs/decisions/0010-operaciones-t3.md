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
