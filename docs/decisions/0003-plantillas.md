# 0003 - Plantillas base (fase 4)

Fecha: 2026-11-01. Alcance: las capas base de `templates/` para que `project_create` produzca un proyecto real. Fuera de alcance (y sin bloquear): `app_create`, MFA, invitaciones, login social, Capacitor, `ui_*`.

Origen: las plantillas parten de un proyecto de referencia (Laravel 12) del que solo se tomó el comportamiento esperado y los paquetes de soporte, revisados contra su código y adaptados a Laravel 13. No se copió configuración de entorno, credenciales ni binarios.

## Capas

| Capa | Scope | Orden | Contenido |
|---|---|---|---|
| `laravel` | project | 10 | Esqueleto L13.11 (config, bootstrap, public, migraciones de sesiones/cache/jobs/permisos/Passport), `bootstrap/app.php`, `AppServiceProvider` (limiters `api` y `auth-login`, morph map), `ViteBuildDirectory` (build dir + hot file por app), `config/{auth,authentications,supports,shardevcom,cors,csp,passport}.php` con líneas ancla, `AuthSeeder`, `phpunit.xml`, `tests/bootstrap.php`. Sin código de dominio. |
| `workspace` | project | 15 | `package.json` raíz (scripts agregados), `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `.npmrc`. |
| `packages` | project | 20 | Copias de `supports`, `repositories`, `authentications`, `integrations`, `verification` en `packages/shardevcom/`; añade sus `require` al `composer.json`. El lock registra un hash por paquete (`packages:` en `.ops/lock.yaml`). |
| `app-model` | app (`when: app.is_new`) | 25 | Modelo (`extends Account`), factory y migración de la tabla de la app. |
| `app-auth` | app | 30 | Controlador de auth de la app, `routes/api/<key>.php` (signin con throttle, logout, perfil, change-password, roles, permisos), `routes/web/<key>.php`, vista Blade SPA y los edits que registran guards/provider/entrada de la app. |
| `tests-auth` | project | 40 | Tests de feature que recorren TODAS las apps declaradas (aislamiento de guards, login, logout, perfil, cambio de contraseña, roles 403/200, `authentications:setup` idempotente). |
| `app-react` | app | 50 | SPA por app en `resources/react/<key>`: `package.json` `@<proyecto>/<key>`, `vite.config.ts` (puerto, build dir, hot file y alias propios), `components.json`, `components/ui` propio (button, card, input, label, badge, table, avatar, separator, dropdown-menu, sonner), login, logout, perfil, roles y not-found. Sin páginas de negocio. |
| `app-workspace` | app | 55 | Scripts `dev:/build:/types:<key>`, entrada en `pnpm-workspace.yaml` y alias `@<key>/*` en el tsconfig raíz. |
| `env` | project | 60 | `.env.example` (secretos vacíos), `.env` local (secretos aleatorios), `env.schema`, `.gitignore`. |
| `docker` | project | 70 | `Dockerfile` (multi-stage, usuario sin privilegios, RoadRunner desde la imagen oficial fijada), `docker-compose.yml` con `${VAR:?}`, `docker/nginx.conf`, `php.ini`, `.dockerignore`. Sin `aws.sh`, `local.sh` ni `start.sh`. |
| `claude-kit` | project | 80 | `CLAUDE.md` y `.claude/rules/*` genéricos (arquitectura, seguridad, laravel, frontend, testing). |
| `verify` | project | 900 | Pasos de verificación (ver abajo). |

Cada capa es independiente: añadir MFA/invitaciones/social será una capa nueva con `when: app.feature.<x>` que añade archivos y edits; ninguna toca el interior de otra salvo por las líneas ancla `// shardev:*` (guards, providers, apps, roles, permisos).

## Cambios al motor (necesarios para las plantillas)

- **`tree`** en `files`: copia una carpeta entera (`dest: .` = raíz). Por defecto copia sin renderizar; `render: [sufijos o rutas]` lista lo que sí se renderiza. Los nombres de archivo admiten `{{ vars }}`. Sin esto las ~340 rutas habría que enumerarlas a mano.
- **Secretos locales** (`{{ secret.app_key | db_password | db_root_password | redis_password }}`): el plan renderiza un marcador reproducible; `project_create` lo sustituye por valores aleatorios (`crypto.randomBytes`) al escribir, con modo 0600. Esos archivos (`.env`) no se hashean en el lock (`local_files`) ni se escanean. Dos planes del mismo spec tienen la misma salida; dos proyectos nunca comparten secretos.
- **Pasos `full`**: `project_create` solo corre los pasos ligeros (lint PHP + escaneos); los pesados (composer, migraciones, tests, pnpm, build, `docker compose config`) los corre `project_verify`. El plan indica `runs_in` por paso.
- **Escaneo de restos**: un archivo generado que contenga un ARN con cuenta AWS de 12 dígitos, un `<cuenta>.dkr.ecr.` o cualquiera de los `leftover_terms` del `config.yaml` del dueño (coincidencia literal, sin distinguir mayúsculas) hace fallar la creación y la verificación. Un término contenido en el nombre/dominio elegido para el proyecto no cuenta. Los términos no forman parte del plan, que sigue siendo determinista.
- **Escaneo de secretos sensible al tipo de archivo**: en código fuente (`.php .ts .tsx .js .css .html .htaccess`) solo cuentan los tokens con forma conocida y los literales asignados a nombres inequívocos de credencial (`password`, `secret`, `api_key`...); en config/texto sigue el redactor completo, pero las referencias `${VAR}`/`$VAR` no cuentan. Antes daba 80 falsos positivos (`password: z.string()`, `$token = $a->token()`). Los tests existentes de escaneo no se tocaron.
- **Variables derivadas** `app.model_class`, `app.factory_class`, `app.controller_class` y `project.primary_*`: el renderer trata `\{{` como escape, así que un namespace seguido de variable (`App\Models\{{ app.model }}`) no se puede escribir.
- **CLI**: binario único `shardev` (paquete `@shardev/cli`); `shardev mcp serve` y `shardev project plan|create|verify [--json]` sobre las mismas funciones que las herramientas MCP (`src/cli-run.ts`).

## Paquetes incluidos

Las plantillas llevan copias locales de cinco paquetes en `packages/shardevcom/`:

| Paquete | Qué aporta a un proyecto generado |
|---|---|
| `repositories` | Clase base `Repository`, hooks, comando `make:repository` y tests. |
| `verification` | Desafíos OTP por correo con código hasheado, tope de intentos y enfriamiento de reenvío. Es la única implementación de OTP del proyecto. |
| `supports` | Controlador base, helpers, traits (`HasAuthorizable`, `HasBelongsToOwner`, importación/exportación...), respuestas JSON, cabeceras de seguridad y CSP, repositorios de roles/permisos/archivos y `PermissionSyncService`. |
| `authentications` | Registro de apps (`config('authentications.apps')`): `Account` (base de los modelos de cada app), `AccountAuthService`, `AccountAuthController`, requests de login/perfil/cambio de contraseña, `AccountResource`, eventos `AccountCreated`/`PasswordChanged`, comandos `authentications:setup` y `authentications:create-account`, y controladores de roles y permisos con sus imports/exports. |
| `integrations` | Verificadores de `id_token` OIDC (Google, Microsoft, Apple) con firma contra el JWKS del emisor y comprobación de `iss`/`aud`/`exp`. Es lo que usa la capa de login social. |

Los paquetes de dominio no se importan entre sí: `authentications` no depende de `integrations` ni de `verification`; el `composer.json` raíz las requiere todas. Los paquetes copiados registran su hash en `.ops/lock.yaml`.

## Reglas de diseño que aplican las plantillas

- **Sin credenciales literales.** `docker-compose.yml` usa `${VAR:?define VAR en .env}` (`docker compose config` falla si falta) y el healthcheck de MySQL toma la contraseña del entorno del contenedor (`MYSQL_PWD=$$MYSQL_ROOT_PASSWORD`). Los secretos locales se generan aleatorios en `.env` al crear el proyecto.
- **Sin binarios versionados.** El `Dockerfile` toma `rr` de la imagen oficial `ghcr.io/roadrunner-server/roadrunner` con versión fijada (`RR_VERSION=2025.1.15`; Octane rechaza la 3.x) y en local se obtiene con `vendor/bin/rr get-binary`. `/rr` y `.rr.yaml` van al `.gitignore`.
- **Sin secretos con valor por defecto.** No hay `env('X', 'valor-secreto')`: un secreto requerido ausente debe impedir el arranque. `tests/bootstrap.php` genera `APP_KEY` y las llaves OAuth aleatorias en cada ejecución.
- **CORS con lista blanca.** Orígenes desde `CORS_ALLOWED_ORIGINS` (lista exacta; un `*` lanza excepción al arrancar), `supports_credentials: false` (la API usa Bearer) y nginx sin cabeceras CORS.
- **id_tokens siempre verificados.** Un proveedor desconocido se rechaza; la verificación usa los verificadores de `integrations` (firma contra JWKS, `iss`, `aud`, `exp`) y nunca un decode sin verificar ni un correo enviado por el cliente como identidad. La regla queda en `.claude/rules/security.md` del proyecto generado.
- **Sin tokens en logs.** Las plantillas no registran tokens ni cuerpos de petición (`AccountAuthService` registra solo la clave de la app).
- **Passport con un cliente de acceso personal por provider.** Sin cliente, `createToken()` falla. `php artisan authentications:setup` (idempotente: llaves + un cliente por provider) lo resuelve; lo invoca `AuthSeeder` y el script `composer setup`, y el `Dockerfile` y `CLAUDE.md` lo documentan como paso de cada despliegue. El login responde un error claro si falta. Pruebas incluidas: `tests/Feature/GuardIsolationTest.php` (un token de una app se rechaza en las otras aunque compartan id) y `AuthFlowTest::test_authentications_setup_es_idempotente...`.
- **Archivos sensibles fuera de las plantillas.** No se incluyen `.env`, `.npmrc`, llaves de firma ni keystores.
- **Sin restos de otros proyectos.** Verificado en cada `project_create`/`project_verify` (ver "Escaneo de restos").

## Laravel 13: qué hubo que adaptar

Todo resolvió e instaló: laravel/framework 13.39, passport 13.10, octane 2.22, spatie/laravel-permission 8.3, maatwebsite/excel 3.1.70, phpunit 12.5, testbench 11.3, PHP ^8.3.

- **`spatie/laravel-csp`: la 2.x no soporta L13**; la 3.x cambia la API (`Directive`/`Keyword` son enums, políticas = *presets*). Se portaron `ContentSecurityPolicy` (ahora `Preset`), `SecurityConfigService`, `config/security.php` (claves con `->value`) y `config/csp.php`; se eliminó `AddCspHeadersMiddleware` (se usa `Spatie\Csp\AddCspHeaders` directo) y `csp_nonce()` pasó a `app('csp-nonce')`. `CSP_REPORT_ONLY=true` publica la política sin bloquear. Probado solo que arranca y que `composer`/tests pasan: **no se verificó la cabecera CSP en un navegador**.
- Passport 13 ya no carga sus migraciones: se incluyen las cinco `oauth_*` en la capa `laravel`.
- `php artisan test` no acepta `--no-interaction`.

## Verificación real (proyecto `acme`: `web`→users/website y `adm`→admins/admin)

`project_plan` + `project_create` + `project_verify` contra un temporal con config/estado/HOME aislados (`tests/generated-project.slow.test.ts`, `npm run test:slow`, ~70 s con red):

- `php-lint` de app/config/routes/database/tests/packages: OK (se ejecuta en `project_create`).
- `composer install`: OK. `php artisan route:list`: arranca. `migrate` + `db:seed` en SQLite: OK.
- `php artisan test`: **39 pruebas, 150 aserciones, OK** (las del proyecto + `repositories/tests`).
- `pnpm install`, `pnpm run types` y `pnpm run build` de `web` y `adm`: OK (public/build-web y public/build-adm).
- `docker compose config --quiet`: OK; sin `.env` falla con "required variable ... is missing" (a propósito).

## No verificado / limitaciones

- `docker compose up`, build de imágenes, `octane:start` y RoadRunner: **no se ejecutaron** (fuera de alcance). El `Dockerfile` y `nginx.conf` solo pasaron `compose config`.
- No se abrió ninguna SPA en un navegador: login, perfil y roles están verificados por tipos/build y por los tests de API, no visualmente. La CSP real tampoco.
- `user_type: existing` (modelo y tabla ya existentes) solo genera guards, rutas y SPA; el modelo `App\Models\<Model>` debe existir y extender `Account`. No se probó.
- Las capas base usan email + contraseña en todas las apps; el login por OTP y el social son capas de feature opcionales (ver 0005) y MFA e invitaciones aún no existen.
- `@shardev/common` exige `firebase` aunque no se use (importa el adaptador sin carga diferida) y persiste el token en `localStorage` con una clave embebida en el bundle (no ofrece confidencialidad real): es un límite heredado de ese paquete, se documenta en `CLAUDE.md`/reglas; no se arregla desde la plantilla. El `appKey` de cada app es un identificador, no un secreto.
- `project_plan` devuelve ~340 rutas en `files_to_create`; es largo para un LLM. Pendiente: resumir por capa.
- Las dependencias de npm usan rangos (`^`), sin lockfile; `project_create` no genera `composer.lock` ni `pnpm-lock.yaml` (se crean en la primera instalación).
- En los proyectos generados: laravel/octane, laravel/passport, spatie/laravel-permission, spatie/laravel-csp, maatwebsite/excel (de `supports`), firebase/php-jwt (de `integrations`), roadrunner-cli/http; npm: @shardev/common, radix-ui, react-hook-form, zod, sonner, next-themes, firebase, tailwind v4 y vite 8.
