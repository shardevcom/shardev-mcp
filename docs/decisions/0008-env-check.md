# 0008 - Validar la configuración de un entorno: `ops_env_check`

Fecha: 2026-11-01. Alcance: una herramienta T0 (`ops_env_check`) y su CLI (`shardev ops env-check`). Valida **archivos locales**; no llama a AWS, no cambia nada y no usa red.

## Límite principal

Solo valida lo que hay en disco. No comprueba que esos valores sean los que están desplegados (secretos, task definitions, variables del servicio), que el perfil AWS exista o tenga sesión, ni que los recursos nombrados existan. Un `ok: true` significa "la configuración local es coherente", no "el entorno está bien".

## Dónde busca: `root`

`path` de `projects.yaml` contiene `ops.yaml`, pero el manifest puede vivir fuera del repositorio de código. Se añade `root` (ruta absoluta, opcional) a la entrada del proyecto: es el árbol que contiene `.aws/env/` y `env.schema`. Por defecto es `path`. Un `root` relativo se rechaza al resolver el proyecto. El esquema sigue siendo estricto, y las entradas antiguas (sin `root`) siguen siendo válidas.

**Orden de actualización:** igual que `services`, una versión anterior de `shardev` rechaza `root` (`Unrecognized key`). Actualiza el CLI antes de añadir la clave.

## Convenciones (documentadas, no inferidas del proyecto)

- Disposición: `<root>/.aws/env/<entorno>/{aws,environment,secrets}.env`. Los tres deben existir, ser archivos regulares (no enlaces simbólicos) y su ruta real debe quedar dentro de la raíz; vale también para el directorio del entorno.
- `secrets.env`: aviso si es accesible por grupo u otros (cualquier bit de `0o077`); fallo si git lo versiona (`git rev-parse` y `git ls-files --error-unmatch`, vía el runner, con arrays de argumentos). Si la raíz no es un repositorio, o no hay git, es un aviso, no un fallo.
- Formato de los archivos: líneas `KEY=valor`, comentarios `#`, prefijo `export`, comillas simples o dobles (también en varias líneas, p. ej. PEM). Nombres válidos: `^[A-Z_][A-Z0-9_]*$`. Son fallos: nombres duplicados, nombres inválidos, líneas sin `=` y comillas sin cerrar.
- `env.schema` (opcional, en `<root>`): una variable por línea, `<categoría> <NOMBRE>`, con categoría `secret` (debe estar en `secrets.env`), `public` (en `environment.env` o `aws.env`) o `exclude` (nunca llega al contenedor; no se valida su ubicación). `#` comenta. Extensión de esta herramienta: un tercer token opcional `required` marca la variable como obligatoria (debe existir y no estar vacía). Sin `required`, una variable vacía es un aviso. Una `secret` fuera de `secrets.env` es un fallo; una `public` en `secrets.env`, un aviso; cualquier `VITE_*` en `secrets.env` (o declarada `secret`) es un fallo, porque va al JS del frontend. Sin `env.schema`, el check se omite con un aviso.
- Aislamiento (entornos que no son producción): `DB_DATABASE`, `DB_USERNAME`, `REDIS_HOST`, `AWS_PROJECT_NAME` y `AWS_DOMAIN_NAME` deben diferir de los del entorno de producción. La referencia es el directorio de cada entorno de producción del manifest (según `classifyEnvironment`) o, si existe, `.aws/env/production/`. Igual a producción es un fallo; faltante en un lado u otro, un aviso; sin configuración de producción, se omite.
- Consistencia: si están definidas, `AWS_PROFILE`, `AWS_ACCOUNT_ID`, `AWS_ECS_CLUSTER_NAME` y `AWS_DEFAULT_REGION`/`AWS_REGION` deben ser iguales a `aws_profile`, `account_id`, `cluster` y `region` del manifest.
- Manifest y política (sin llamar a AWS): el entorno debe existir (si no, se rechaza antes de mirar archivos, igual que `env` omitido); `services` y `capabilities` deben estar declarados (fallo si no); si el entorno es producción (por manifest, nombre o `production_envs`) debe haber una regla en `aws_profiles` de `policy.yaml` para su perfil, con la misma lógica que `decide` pero sin la identidad (fallo si falta). Un conflicto de clasificación o una política efectiva `disabled` por otra causa son avisos.

## Los valores nunca salen

Los mensajes contienen solo nombres de variables, rutas relativas a la raíz, números de línea y conteos; ni siquiera los valores que no son secretos (perfil, cuenta, región) se reproducen, para mantener una única regla simple. El parser conserva de cada valor únicamente si está vacío y un SHA-256, que sirve para compararlo en memoria con otro archivo o con el manifest y nunca se imprime ni se audita. Las líneas inválidas se reportan por número, no por texto. Un test siembra valores distintivos en todos los archivos (con líneas mal formadas, nombres inválidos, duplicados y comillas sin cerrar) y comprueba que no aparecen en la respuesta MCP ni en la auditoría.

## Resultado y código de salida

`{project, env, ok, checks: [{name, status, message}], counts}`; `status` es `ok`, `warn`, `fail` o `skip`. `ok` es falso si algún check es `fail`; entonces la herramienta devuelve `isError` y la CLI sale con 1. Los avisos no fallan. Un error de entrada (proyecto no registrado, `env` omitido o desconocido, `root` relativo) se rechaza antes de ejecutar los checks.

## Auditoría

Al ser T0 pasa por el mismo envoltorio MCP que el resto y queda en `audit.jsonl` con `project` y `env` (nunca valores). La CLI también lo registra, con `source: "cli"` (ADJ-09).

## Fuera de alcance

Crear o repartir archivos de entorno (ENV-02, ENV-03), perfiles AWS (ENV-04), comparar con lo desplegado o con las variables de GitHub (CI-02), y validar el contenido semántico de los valores (formato de URL, de claves, etc.).
