# 0009 - Workflows de despliegue: `ops_ci_check` y `ops_ci_generate`

Fecha: 2026-11-01. Alcance: una herramienta T0 (`ops_ci_check`), una T2 (`ops_ci_generate`) y sus CLI (`shardev ops ci-check|ci-generate`). Trabajan sobre archivos locales: no llaman a AWS, a GitHub ni a git.

## Qué hacen

Renderizan la plantilla **del proyecto** `<root>/.github/templates/deploy.template.yml` en `<root>/.github/workflows/deploy-<env>.yml` (`root` se resuelve igual que en `ops_env_check`, ver 0008). Este paquete no incluye ninguna plantilla por defecto: si falta, el error lo dice. La plantilla por defecto pertenece a TPL-01.

## Convenciones

- Marcadores: `@@ENVIRONMENT@@`, `@@ENV_LABEL@@` (entorno con la primera letra en mayúscula), `@@MOBILE_LABEL@@` (`" + Mobile"` o vacío), `@@TRIGGER@@` y los bloques `@@MOBILE_BEGIN@@` / `@@MOBILE_END@@`, que se conservan (sin las líneas de marcador) o se eliminan enteros. Las líneas anteriores a la primera `name:` (la cabecera de la plantilla) se descartan.
- Es un error: cualquier `@@` que quede, un `BEGIN` sin `END` (o al revés, o anidados), una plantilla sin `name:` y un resultado que no sea YAML válido.
- Disparador: con rama, `push` a esa rama más `workflow_dispatch`; sin rama, solo `workflow_dispatch`. La rama cumple `^[A-Za-z0-9._/-]+$`.
- Cabecera generada: avisa de que el archivo es generado y no debe editarse, y guarda las opciones en una línea `# Opciones: [--branch=X] --mobile|--no-mobile`.
- Opciones: si no se pasa `branch` ni `mobile`, se reutilizan las de la línea `# Opciones:` del workflow actual (misma regla que el script de referencia: es todo o nada; pasar solo `mobile` descarta la rama guardada). La rama guardada se valida como cualquier otra.
- Producción (según `classifyEnvironment`): exige rama, explícita o guardada; nunca hay un valor por defecto silencioso. `mobile` es `true` por defecto. No existe `--no-branch`. Entornos que no son producción: `mobile` es `false` por defecto y las ramas `main` y `master` se rechazan (despliegan producción).
- El nombre del entorno debe cumplir `^[a-z][a-z0-9-]{1,30}$`, además de existir en `ops.yaml`.

## Por qué el MCP no escribe producción

Cambiar un workflow de producción puede iniciar despliegues reales con el siguiente push, y la persona que lo revisa podría no ver que lo hizo un agente. Por eso `ops_ci_generate` sobre un entorno de producción devuelve `decision: "command-only"`, `written: false` y el comando exacto (`renderCommand`), con las opciones ya resueltas. La CLI, ejecutada por una persona, escribe cualquier entorno. Los T2 de producción en el resto del catálogo se tratan como T3; aquí no hay escritura que gatear, solo un comando.

## Comparación: cabecera ignorada

La comparación se hace desde la primera línea `name:` de ambos textos (con `\r\n` normalizado). Los workflows generados por otras herramientas llevan una cabecera distinta y deben contar como al día si el cuerpo coincide. Esa cabecera sí se lee para obtener `# Opciones:`. El diff (`src/gen/diff.ts`) es de cuerpo contra cuerpo, está acotado a 120 líneas y 6000 caracteres (`diff_truncated`) y `differing_lines` cuenta todas las líneas `+`/`-`. Un archivo ausente es `missing`, sin diff. La salida pasa por el redactor aunque un workflow solo debería citar nombres de secretos.

## Escritura

Solo a la ruta exacta de salida: temporal en el mismo directorio (`wx`, modo 0644) y `rename`. Si ya está al día no se reescribe. Se rechazan enlaces simbólicos en el archivo de salida, en la plantilla y en `.github`, `.github/workflows` y `.github/templates`, y cualquier ruta real fuera de la raíz. No se hace commit ni push: la respuesta dice que el archivo debe revisarse y versionarse.

## Límites

No se comprueba el estado de git (si el workflow está versionado, si hay cambios sin commit) ni nada en GitHub (que la rama exista, que el workflow esté activo, que el GitHub Environment y sus variables estén configurados: eso es CI-02). `up_to_date` significa "el archivo local coincide con la plantilla local".

## Fuera de alcance

La plantilla por defecto (TPL-01), `--no-branch` para volver a "solo manual" un entorno que no es producción, variables y secretos del GitHub Environment (CI-02).
