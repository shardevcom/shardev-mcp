# 0004 - `app_plan` / `app_create` (añadir una app a un proyecto generado)

Fecha: 2026-11-01. Alcance: el mecanismo central para añadir una app frontend a un proyecto YA generado por shardev. Fuera de alcance (y sin bloquear): las capas de feature (que llegaron después, ver 0005), Capacitor, `ui_*`, fases AWS y el almacenamiento de tokens de `@shardev/common`.

## Qué hace

`app_plan` (MCP) / `shardev app plan` calcula, sin escribir el proyecto, lo que haría añadir una app; `app_create` / `shardev app create` aplica un `plan_id`. Ambos son T2 (cambio local, sin AWS) y comparten implementación con la CLI (`src/gen/app.ts`, `src/ops/app.ts`, `src/cli-run.ts`), igual que `project_*`.

Entrada de `app_plan`: `project_path` (dentro de `allowed_roots`), `key`, `user_type` (`new`|`existing`) y, opcionales, `provider`, `table`, `model`, `api_guard`, `session_guard`, `port`, `build_dir`, `features`. Los nombres se derivan de la `key` con `deriveApp` (las mismas convenciones que el spec: `supp` => provider/tabla `supps`, modelo `Supp`, guards `supp` + `supp_session`, build `build-supp`). El puerto por defecto es el primero libre desde 5173. `features` se valida contra las capas existentes: una feature sin capa se rechaza diciendo que la capa todavía no existe, y un nombre desconocido se rechaza por el esquema (ver 0005; `mfa` e `invitations` existen desde 0006).

## Dónde queda registrada la app

En `.ops/lock.yaml`, que es lo que ya usa `project_verify` (el `ops.yaml` es el manifest de operaciones AWS del dueño y el generador no lo escribe). `app_create` reescribe el lock con: `spec.apps` + la app nueva, `layers` (unión), y `files` con los hashes de los archivos nuevos. Todo lo demás del lock (`template_hash`, `local_files`, `packages`, `generator`...) no se toca, así que `project_verify` cubre la app nueva sin cambios: los pasos salen de las plantillas con el spec nuevo, escanea los archivos del lock y `tests-auth` recorre todas las apps declaradas en tiempo de ejecución.

Los archivos EDITADOS (`config/auth.php`, `package.json`...) solo actualizan su hash en el lock si seguían idénticos al hash registrado; si el dueño los había modificado, el hash antiguo se conserva (la deriva sigue visible) y el plan lo avisa como nota.

## Qué se renderiza

Solo capas de `scope: app` y solo para la app nueva (`buildOutputs(..., { onlyApps })`: las capas de proyecto y mobile devuelven cero instancias). Hoy: `app-model` (si `user_type: new`), `app-auth`, `app-react`, `app-workspace`, más cualquier capa de app futura cuyo `when` se cumpla. Los archivos de proyecto (`composer.json`, `tests/`, `bootstrap/`, `.env`, `docker-compose.yml`...) nunca se vuelven a renderizar; el plan lo comprueba (todo archivo sale de una capa de app o es el lock) y falla si no.

El cableado es el de siempre: inserciones ancladas (`// shardev:*`) y merges JSON/YAML. Ninguna plantilla necesita variables de entorno nuevas, así que `.env`, `.env.example` y los secretos no se tocan.

## Seguridad

| Caso | Comportamiento |
|---|---|
| key inválida (`^[a-z][a-z0-9]{0,30}$`) | error de entrada |
| key reservada | error; lista en `RESERVED_KEYS`: rutas y carpetas del proyecto (`api`, `storage`, `build`, `vendor`, `oauth`, `tests`...) y palabras reservadas de PHP (`list`, `static`, `match`...) |
| key / guard / provider / tabla / modelo / puerto / build_dir ya usados | error con el valor y las dos apps (reutiliza la validación del spec) |
| modelo `Account`, `Model`, `Role`... o tabla del framework/Passport/Spatie | error |
| guard, provider o app ya escritos a mano en `config/auth.php` / `config/authentications.php` | conflicto que nombra el archivo |
| `project_path` fuera de `allowed_roots`, relativo, con `..` | error (`assertTargetAllowed`) |
| proyecto sin `.ops/lock.yaml` o con lock inválido | error `not_shardev_project` |
| archivo destino ya existente | conflicto que lo nombra; nunca se sobrescribe |
| ancla ausente, editada o ambigua | conflicto que nombra el archivo y la ancla |
| edit que sería no-op porque ya estaba aplicado a mano | conflicto (no se omite en silencio) |
| conflictos en el plan | `plan_id: null` (no se guarda nada) e `isError` |
| secretos o restos (ARN/ECR con cuenta, términos de `leftover_terms`) en lo que se va a escribir | conflicto con ruta y línea (nunca el contenido), ya en el plan |
| repo git en `master`/`main` | conflicto (misma regla que `planExisting`) |

El escaneo previo (`scanText`, nuevo en `verify.ts`) mira los archivos nuevos completos y, de los editados, solo las líneas añadidas (lo que el dueño ya tenía no es asunto del escaneo). Tras escribir, `verifyTree` repite el escaneo sobre los archivos creados y corre los pasos ligeros de las capas del lock (hoy `php-lint` de todo el proyecto).

### `plan_id` atado al estado

El plan guarda `target_hash` = hash de: el contenido previo (o "ausente") de cada archivo que toca, el lock, `config/auth.php`, `config/authentications.php` y el modelo (`app/Models/<Model>.php`). `app_create` re-planifica contra el estado actual y exige que `target_hash` y `outputs_hash` coincidan con los del plan; si un archivo relevante cambió, se niega con `plan_stale` y pide `app_plan` de nuevo. Además, cada edit se escribe solo si el archivo sigue idéntico a lo planeado en ese instante (ventana TOCTOU mínima). Mismo HMAC y TTL de 30 min que los demás planes; el plan guarda la entrada normalizada (`app`) y se consume al aplicar.

### Sin estado parcial

Orden de escritura: archivos nuevos, edits y, al final, el lock (la última escritura es la que declara la app). Ante cualquier fallo (escritura, edit cambiado, cableado, verificación) se restauran los editados (solo los que empezaron a escribirse y siguen distintos del original), se borran los creados y se eliminan las carpetas que se crearon. El resultado dice `rolled_back: true`, o los problemas de la reversión si los hubo. El plan NO se consume en fallo, pero el siguiente `app_create` volverá a validar contra el estado actual.

## `user_type: existing`

Sin tabla, migración, modelo ni factory nuevos (la capa `app-model` no corre). Exige en el plan que `app/Models/<Model>.php` exista, esté en el namespace `App\Models` y declare `class <Model> extends Account` directamente (con `use Shardevcom\Authentications\Models\Account` o el nombre completo). No se aceptan herencias indirectas ni la clase solo mencionada en un comentario: es la opción más conservadora y un falso rechazo se arregla con una línea. Si el modelo declara `protected $table = '...'`, esa es la tabla (una `table` distinta es error); si no, se usa la derivada/indicada y no se comprueba contra la base de datos (el plan no se conecta a ninguna). Si el modelo no tiene factory se avisa en `notes`: `tests-auth` solo cubre las apps con `Model::factory()`.

Decisión de diseño: "existente" significa un modelo que el proyecto ya tiene (escrito por el dueño) pero que ninguna app declarada usa. Sigue valiendo la regla de que cada app tiene su propio provider, tabla y modelo: reutilizar el modelo de OTRA app se rechaza por duplicado (si dos apps compartieran tabla, un token de una serviría en la otra, que es justo lo que `GuardIsolationTest` prohíbe). Es lo más conservador; compartir una tabla entre apps requeriría decidir cómo aislar los providers y queda fuera.

## Verificación real

Rápida: `tests/app-create.test.ts` (27 + 1 de CLI) con plantillas reales y un runner inerte. Lenta: `tests/app-create.slow.test.ts` genera `acme` (web, adm), añade `supp` (new) y `partner` (existing con modelo, factory y migración escritos a mano) y corre `project_verify` completo.

## Límites y decisiones abiertas

- Las plantillas pueden haber cambiado desde que se creó el proyecto: se avisa (`notes`), no se bloquea. Las capas de proyecto no se actualizan, así que una plantilla de app que dependa de un cambio de proyecto posterior fallaría en `project_verify` (no en el plan).
- `app_create` no hace commit, ni crea rama, ni corre migraciones/composer/pnpm (eso es `project_verify`). Tampoco exige árbol limpio ni git: el proyecto de `project_create` no es un repo. Si lo es, rechaza `master`/`main`.
- Las claves reservadas no se validan en `project_plan` (fuera de alcance; una app `api` en el spec inicial seguiría pasando).
- Las features son capas `scope: app` con `when: app.feature.<x>`; el modo `onlyApps` las renderiza sin cambios y el lock admite `features` por app. `otp` y `social` existen (ver 0005); `mfa` e `invitations` también (ver 0006).
- `app_plan` no registra el proyecto en `projects.yaml` (eso sigue siendo del dueño); `project_verify` lo necesita.
