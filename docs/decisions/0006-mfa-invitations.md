# 0006 - Features `mfa` e `invitations` (capas de app)

Fecha: 2026-11-01. Alcance: las dos últimas capas de feature por app. Fuera de alcance: Capacitor (`mobile_add`), `ui_*`, AWS, el almacenamiento de tokens de `@shardev/common`, añadir una feature a una app que ya existe y las limitaciones de 0005 (no se tocaron).

Origen: del proyecto de referencia solo se tomó el comportamiento esperado (un segundo factor TOTP con desafío de login, y el alta por invitación con token de un solo uso); no se copió código.

## Cómo se pide

`features: ["mfa"]` y/o `["invitations"]`, por app, tanto en el spec de `project_create` como en `app_plan`/`app_create` (`--features mfa,invitations` en la CLI). No hay parámetros nuevos. Dos combinaciones se rechazan al validar el spec (mensaje claro, por app):

| Combinación | Motivo (v1) |
|---|---|
| `mfa` con `otp` o `social` | Esos caminos emiten el token sin pasar por el segundo factor (el código por correo o el id_token ya son el único factor). Hacerlas compatibles exige decidir qué cuenta como "segundo factor" en cada una; queda fuera de v1. |
| `invitations` con `auto_register` | Crear la cuenta en el primer login válido anula el alta cerrada que garantiza `invitations`. |

`invitations` sí se combina con `otp` o `social` (sin `auto_register`) y con `mfa`.

## Capas

| Capa | Scope | Orden | Contenido (por app con la feature) |
|---|---|---|---|
| `app-mfa` | app, `app.feature.mfa` | 37 | `app/Auth/Mfa/`: controlador, servicio, tres requests y dos modelos (factor y desafío); migración `<tabla>_mfa` (y `<tabla>_mfa_challenges`); `config/mfa_<key>.php`; `routes/api/<key>-mfa.php`. Merge JSON de `pragmarx/google2fa` en `composer.json`. |
| `mfa-deps` | app, `app.feature.mfa` | 899 | Solo un paso de verificación pesado, `composer-sync-mfa`, antes de `composer-install` (ver "composer.lock"). |
| `tests-mfa` | app | 43 | `tests/Feature/<Modelo>MfaTest.php`. |
| `app-react-mfa` | app | 53 | `pages/auth/sign-in/mfa-challenge.tsx` y `pages/profile/mfa-settings.tsx`. |
| `app-invitations` | app, `app.feature.invitations` | 38 | `app/Auth/Invitations/`: controlador, servicio, dos requests, modelo y mailable; `app/Console/Commands/<Modelo>InviteCommand.php` (`<key>:invite`); vista del correo; migración `<tabla>_invitations`; `config/invitations_<key>.php`; `routes/api/<key>-invitations.php`. |
| `tests-invitations` | app | 44 | `tests/Feature/<Modelo>InvitationsTest.php`. |
| `app-react-invitations` | app | 54 | `pages/auth/accept-invitation/index.tsx` y `pages/invitations/index.tsx`. |

Son capas `scope: app`: funcionan igual desde `project_create` y desde `app_create` (que nunca re-renderiza capas de proyecto). Todo va en archivos con la `key` en el nombre; no hay archivos ni tablas compartidos entre apps (cada app con la feature tiene su `<tabla>_mfa`, su `<tabla>_mfa_challenges` y su `<tabla>_invitations`).

### Cableado y cambios a plantillas existentes

Como en 0005, lo que *cambia* algo existente va en bloques `{{#if app.feature.x}}`. Con la feature apagada no queda rastro (ver "Comparación sin features").

- `app-auth/files/AuthController.php`: con `mfa`, la app sobrescribe `signin` y delega en `<Modelo>MfaService`. El `signin` de `AccountAuthController` emite el token sin segundo factor; así, aunque alguien enrute a ese controlador, no hay bypass. La ruta `<key>.signin` y su throttle no cambian (por eso `AuthFlowTest` sigue recorriendo la app y pasa: una cuenta sin MFA recibe la respuesta normal).
- `app-auth/layer.yaml`: con `invitations`, el bloque de permisos de ese guard en `config/shardevcom.php` gana `'invitations' => ['admin' => ['list', 'create', 'remove']]`. Va dentro del bloque existente del guard (una segunda entrada con la misma clave de guard lo habría sobrescrito).
- `app-react`: `hooks/auth` (con `mfa`, `login` usa `auth/signin` y devuelve el desafío si lo hay), `types` (`MfaPending`), `pages/auth/sign-in` (paso del código), `pages/profile` (tarjeta de MFA), `routes/index.tsx`, `routes/paths.ts` y `layouts/app` (ruta y enlace de invitaciones). La ruta de `signin` con una sola línea se conserva tal cual cuando no hay `invitations`.
- Sin variables de entorno nuevas: `MFA_ISSUER` es opcional (por defecto `APP_NAME`), todo lo demás está en los `config/*_<key>.php`.

### Cambio al motor: `idempotent` en `json-merge`

`app_create` rechaza un edit que no cambia nada ("ya estaba aplicado, ¿cambios manuales?"). Eso rompía la 2ª app con mfa en un proyecto que ya tiene mfa: `pragmarx/google2fa` ya está en `composer.json`, y el merge JSON sería un no-op. Se añadió el campo opcional `idempotent: true` a los edits `json-merge` (por defecto `false`): un no-op marcado así no es conflicto (un valor DISTINTO en la misma clave sigue siéndolo). Solo lo usa el merge de la dependencia en `app-mfa`; el resto de edits conserva la regla estricta (hay una prueba que lo mantiene). Se detectó en la prueba lenta, no en las rápidas.

### composer.lock y `project_verify`

`app_create` no re-renderiza capas de proyecto, así que la dependencia entra por el merge JSON que hace `app-mfa` (`require.pragmarx/google2fa: ^9.0`; idempotente entre varias apps con mfa). Se comprobó que un proyecto que ya tiene `composer.lock` y recibe después una app con mfa **falla** en `composer install` ("Required package pragmarx/google2fa is not present in the lock file"). Y `composer update <paquete>` falla si NO hay lock ("Cannot update only a partial set of packages without a lock file present"). Por eso la capa `mfa-deps` añade el paso `composer-sync-mfa` (orden 899, antes del `composer-install` de la capa `verify`, que es 900): `sh -c 'if [ -f composer.lock ]; then composer update pragmarx/google2fa --with-dependencies ...; else composer install ...; fi'`. Solo aparece en proyectos con una app mfa (el lock del proyecto lo registra) y solo lo corre `project_verify`. Un proyecto con mfa generado a mano sin ese paso necesita `composer update pragmarx/google2fa` a mano.

`composer audit` sobre un proyecto generado con mfa: sin avisos de seguridad (`pragmarx/google2fa` v9.1.0, `paragonie/constant_time_encoding` v3.1.3). No hay dependencias npm nuevas: el SPA muestra el secreto y un enlace `otpauth://` (sin librería de QR).

## MFA: decisiones

**Opt-in por cuenta, sin tocar la cuenta.** Una fila en `<tabla>_mfa` (FK `account_id` con `ON DELETE CASCADE`, único). La tabla de la cuenta no cambia. Mismo razonamiento y orden de migraciones que `<tabla>_social_identities` (0005): la migración (`2026_01_01_000210`) usa FK sin alternativa; en una app `existing` cuya tabla se cree en una migración posterior falla en voz alta y hay que reordenar (sin FK, un id reutilizado heredaría el factor). La misma migración crea `<tabla>_mfa_challenges` (desafíos de login); es una tabla más por app, nunca compartida.

**Alta en dos pasos.** `POST auth/mfa/setup` genera un secreto pendiente (32 caracteres base32 = 160 bits; repetirlo lo reemplaza; con MFA activo responde 409) y devuelve el secreto y la URL `otpauth://`. El pendiente no protege nada: el login sigue dando token hasta que `POST auth/mfa/confirm` recibe un código TOTP válido. Confirmar entrega los 10 códigos de recuperación (única vez que se ven) y cierra las demás sesiones de la cuenta (conserva la actual). Desactivar (`POST auth/mfa/disable`) y regenerar códigos (`POST auth/mfa/recovery-codes`) exigen contraseña actual Y un código válido (mismo 422 para cualquiera de los dos fallos); desactivar también cierra las demás sesiones.

**Secretos en reposo.** El secreto usa el cast `encrypted` (APP_KEY); `$hidden` y `$fillable` limitados (`account_id` no es asignable en masa; lo fija el servicio). Los códigos de recuperación se guardan como HMAC-SHA256 con la clave de la app: son aleatorios de ~50 bits, de un solo uso y con tope de intentos, y así no hay 10 bcrypt por comprobación; se comparan todos con `hash_equals` sin cortar el bucle. Es una decisión explícita frente a `Hash::make`: la desventaja es que quien tenga la base de datos Y APP_KEY puede ir por fuerza bruta offline sobre ~50 bits.

**TOTP con `pragmarx/google2fa`** (no se escribió TOTP a mano): ventana de ±1 paso (`mfa_<key>.window`).

**Anti-repetición.** `verifyKeyNewer` con el último paso guardado (siempre entero: con `null` la librería devuelve `true` en vez del paso) y además un `UPDATE ... WHERE last_used_step IS NULL OR last_used_step < :paso` cuyo resultado debe ser exactamente 1 fila. Son dos capas: quitar cualquiera de las dos sola no rompe el comportamiento secuencial, así que la prueba de concurrencia reutiliza una lectura vieja de la fila (como dos peticiones en vuelo) y solo el UPDATE condicional distingue; se comprobó que sin él esa prueba falla.

**Desafío de login.** Una contraseña correcta de una cuenta con MFA confirmado devuelve `{ mfa_required, challenge, expires_in, methods }` y NINGÚN token (no se crea ni un token Passport). El desafío son 32 bytes aleatorios; solo se guarda su sha256 en `<tabla>_mfa_challenges`, ligado a la cuenta, con caducidad (300 s), un solo uso y tope de 5 intentos. El intento se reserva ANTES de mirar el código con un `UPDATE ... SET attempts = attempts + 1 WHERE used_at IS NULL AND expires_at > now AND attempts < max` (atómico: dos peticiones simultáneas no gastan más intentos) y se consume con otro UPDATE condicional tras el código correcto. Además hay un tope por cuenta (10 fallos en 15 min, `RateLimiter`) que no se salta pidiendo desafíos nuevos con la contraseña. Cualquier fallo de `verify` (desafío inexistente, caducado, usado, agotado, de otra cuenta o app, cuenta inactiva, código malo, cuenta bloqueada) es el mismo 401 con el mismo cuerpo; sin desafío se gasta un `Hash::check` ficticio. Las cuentas sin MFA, en una app con mfa, reciben la respuesta normal de login.

**Aislamiento entre apps.** El desafío vive en la tabla de la app: uno de otra app no existe aquí. Los tokens siguen la regla de siempre (cliente personal por provider; `GuardIsolationTest` sigue pasando).

**Throttle.** Cada ruta lleva el suyo, con el tercer parámetro (`mfa-verify-<key>`, `mfa-setup-<key>`...); además el servicio limita por desafío y por cuenta.

**Registros.** No se registra el código, el secreto, el desafío ni los códigos de recuperación (la prueba espía `Log` durante todo el flujo, también en los fallos).

### Caminos que emiten token (revisados)

| Camino | Qué hace con mfa |
|---|---|
| `POST auth/signin` -> `AccountAuthController::signin` -> `AccountAuthService::login` | Sobrescrito en `<Modelo>AuthController` y en `<Modelo>MfaController`: pasan por `<Modelo>MfaService::signin`. Una prueba comprueba por reflexión que el método de la ruta no es el de la clase base. |
| `POST auth/mfa/verify` | El único que canjea un desafío por token; exige código. |
| `AuthController::changePassword`, `updateProfile`, `me`, `logout` | No emiten token. |
| `POST auth/otp/*`, `POST auth/social/*` | Rechazados en el spec junto con `mfa` en la misma app. |
| Alta por invitación (`auth/invitations/accept`) | No emite token (ver abajo): el alta no inicia sesión, así que tampoco puede saltarse el MFA. |
| Rutas de Passport (`/oauth/token`, `/oauth/authorize`, `/oauth/device/code`, `/oauth/token/refresh`) | No emiten tokens de cuenta con la configuración generada: solo existen clientes de acceso personal, `enablePasswordGrant()` no se llama y no hay otros clientes. Una prueba lo comprueba con varios `grant_type`. **Límite:** si el dueño crea a mano un cliente OAuth con otro grant (`passport:client --password`...), ese camino no pasa por el segundo factor. |
| `authentications:create-account`, `authentications:setup`, `<key>:invite` | No emiten token. |
| Rutas `/api/verification/*` | No emiten token. |
| Guards de sesión (`website`, `admin`...) | No hay ruta de login por sesión en las plantillas. |

Una prueba generada recorre todas las rutas de `api/<key>/` y exige que las únicas sin `auth:<guard>` sean `signin`, `mfa.verify` e `invitations.accept`.

## Invitaciones: decisiones

**Tabla y token.** `<tabla>_invitations` (migración `2026_01_01_000220`): `email`, `token_hash` (sha256, único), `inviter_id` (FK a la tabla de la app, nullable, `nullOnDelete`: la invitación de arranque no tiene invitador y borrar al invitador no borra el rastro), `expires_at`, `accepted_at`, `revoked_at`. El token son 32 bytes aleatorios (43 caracteres base64url); solo se guarda su sha256 y se busca por ese hash (más un `hash_equals`). Vale 7 días (`invitations_<key>.ttl_days`). Una invitación está ligada al correo invitado y a la app (su tabla).

**Endpoints** (`/api/<key>/...`): `POST invitations`, `GET invitations`, `DELETE invitations/{id}` exigen un token DE ESTA APP y el permiso `create|list|remove:invitations` del guard de la app (`checkPermissionTo(..., guard)`, comprobado en el servicio en cada petición; 403 sin permiso, 401 con token de otra app). El rol `admin` de la app recibe los tres en `config/shardevcom.php`. `POST auth/invitations/accept` es público y con throttle. El invitador sale SIEMPRE de `$request->user($guard)`; `inviter_id`, `token_hash`, `expires_at` y `accepted_at` no son asignables en masa.

**Crear.** Responde 202 con cuerpo fijo exista o no una cuenta con ese correo; el envío se hace con `defer()` después de responder (el tiempo tampoco delata), y si la cuenta existe no se crea ni se envía nada. Reinvitar al mismo correo revoca las pendientes anteriores (solo vale la última); tope por invitador y hora (429) y por correo y hora (en silencio). El correo no es `ShouldQueue` (la cola guardaría el token en claro) y el enlace lleva el token en el FRAGMENTO (`.../<key>/auth/accept-invitation#token=...`): el navegador no lo envía al servidor ni lo deja en logs o `Referer`. En producción, con `MAIL_MAILER` = `log` o `array`, la API responde 503 y el servicio no crea nada (con `log`, el transporte escribiría el correo entero, token incluido, en el log: solo vale en desarrollo).

**Aceptar.** `{ token, name, password }` (sin `password` en apps `otp`). El correo es el de la invitación, nunca el de la entrada. Dentro de una transacción: se busca por hash, se canjea con `UPDATE ... WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now` (exactamente 1 fila) y se crea la cuenta (correo verificado, activa). Si el correo ya tiene cuenta, la transacción se revierte (la invitación no se consume). Inexistente, caducada, usada, revocada, de otra app o con cuenta existente: el mismo 422. La respuesta es `{ accepted: true }`: **no emite token** (el usuario inicia sesión después; así un app con mfa nunca se salta el desafío y no hay sesión creada por un enlace de correo). En una app `otp` (sin contraseña) la cuenta guarda un hash aleatorio de 64 caracteres, como en 0005; si no, la contraseña se valida con `Password::min(10)`.

**Sin roles en v1.** Una invitación no asigna roles: la cuenta nace sin ellos y el dueño le asigna el rol después. Esto evita que invitar permita escalar privilegios (quien invita no puede otorgar más de lo que tiene). Es una limitación consciente, no un olvido.

**Alta cerrada.** Revisadas las plantillas de app y los paquetes: no existe ninguna ruta de auto-registro público (ni `register` ni `signup`). Las únicas formas de crear una cuenta desde fuera eran `auto_register` de `otp`/`social`, que se rechaza junto con `invitations`. Una prueba comprueba que `auth/register`, `register`, `auth/signup` y `signup` dan 404 y que ninguna ruta de la app los contiene.

**Arranque.** `php artisan <key>:invite {email}` (primera invitación, sin invitador; la API necesita ya un administrador con permiso). En producción pide confirmación (o `--force`), se niega con un mailer que no entrega y no imprime el token ni el enlace. El operador es de confianza: el comando sí dice si la cuenta ya existe (la API no lo revela). Para crear al primer administrador el dueño aún puede usar `authentications:create-account` y asignarle el rol `admin`.

## Pruebas generadas

Con la feature presente, en `tests/Feature/` de la app (permitido y rechazado).

- **MFA** (28): alta setup/confirm (pendiente no protege, código malo no activa, doble activación 409), secreto cifrado y códigos hasheados en la base, sin secreto en respuestas, login sin token solo con desafío opaco (sin token creado, desafío hasheado), código bueno canjea, código malo = desafío inexistente, bloqueo por intentos del desafío y por cuenta (también con desafíos nuevos), código repetido (incluido paso siguiente y luego actual), mismo paso en dos desafíos, simultaneidad (lectura vieja de la fila: solo el UPDATE condicional distingue), desafío de un solo uso, caducado, ligado a su cuenta, de otra app y token que no vale en otra app, código de recuperación de un solo uso (mayúsculas incluidas), cuenta inactiva, activar cierra otras sesiones, desactivar y regenerar exigen contraseña Y código, rutas con token de esta app, throttle, sin código/secreto/desafío en logs, `signin` que no es el de la clase base, rutas públicas conocidas, y que `/oauth/token` no emite tokens de cuenta.
- **Invitaciones** (24): permiso permitido y rechazado (por acción), token de otra app rechazado, invitador no asignable, hash en reposo y sin token en ninguna columna, aceptar crea la cuenta verificada sin roles ni token con el correo de la invitación, un solo uso, caducada/usada/revocada/inexistente con la misma respuesta, otra app, existente = misma respuesta y sin correo, correo con cuenta nueva no consume, reinvitar revoca, listado sin token, revocación, contraseña obligatoria o ausente (otp), correo no encolable, producción con mailer `log`/`array`, sin token en logs, throttle, sin registro público, comando de arranque (con y sin confirmación en producción).

Se hicieron pruebas de mutación a mano sobre un proyecto generado (quitar la sobrescritura de `signin`, el permiso, el canje atómico, el UPDATE del paso TOTP, el consumo del desafío y la baja del código de recuperación): cada una hace fallar al menos una prueba.

## Comparación sin features

Un proyecto sin features (`web` + `adm`, 344 archivos) generado antes y después de este cambio: misma lista de archivos y mismos bytes en todos; la única diferencia es `.ops/lock.yaml` (cambia `template_hash`, por cambiar las plantillas). Tampoco cambian el spec del lock, `composer.json` ni la lista de pasos.

## Verificación real

Rápida: `tests/features-mfa-invitations.test.ts` (plantillas reales: nada sin features, qué se genera por app, throttles con tercer parámetro, permisos, sin llaves sin resolver) y ampliaciones en `gen-spec.test.ts` y `app-create.test.ts`. Lenta: `tests/mfa-invitations.slow.test.ts` genera un proyecto con mfa+invitations (web), invitations+otp (adm), añade `supp` con mfa por `app_create` y corre `project_verify` completo (composer, migraciones, PHPUnit con las pruebas generadas, pnpm tipos y build); y otro que verifica un proyecto sin mfa (crea `composer.lock`), le añade una app mfa+invitations y vuelve a verificar (el caso del lock desactualizado).

## Qué NO se verificó

- Ninguna app autenticadora real (Google Authenticator, Authy...) ni la lectura de la URL `otpauth://` por una de ellas; los códigos se calcularon en las pruebas con la misma librería. Tampoco entrega real de correo ni el enlace del correo abierto en un cliente de correo.
- El SPA (pantalla del desafío, tarjeta de MFA, aceptar invitación, gestión) solo pasó tipos y build; no se abrió en un navegador. En particular no se comprobó cómo adapta `@shardev/common` las respuestas de `api.fetch` para listas, ni que `api.insert('auth/signin')` se comporte igual que `api.signIn` fuera del manejo del token.
- MySQL: las pruebas usan SQLite. Allí `lockForUpdate()` no bloquea (no hace falta: SQLite serializa escrituras); en MySQL se confía en el bloqueo de fila y en los UPDATE condicionales, pero la simultaneidad real (dos procesos) no se ejecutó, solo se simuló con lecturas viejas.
- `defer()` bajo Octane/RoadRunner (se probó con el kernel de pruebas).
- Tiempo de respuesta: se igualó el coste donde era razonable (`Hash::check` ficticio, envío con `defer`), pero no se midió.
- La conducta de Passport con clientes OAuth creados por el dueño (ver "Caminos que emiten token").

## Limitaciones conocidas de esta versión

- `mfa` no se combina con `otp` ni `social` (rechazado en el spec); hacerlas compatibles es trabajo futuro.
- Un cliente OAuth creado a mano con otros grants (`passport:client --password`...) no pasa por el segundo factor.
- El tope de fallos por cuenta (10 en 15 min) permite que quien conozca la contraseña bloquee el login por MFA de esa cuenta durante la ventana. Es el precio de que pedir desafíos nuevos no permita adivinar el código sin límite.
- Los códigos de recuperación se guardan como HMAC con APP_KEY (no bcrypt); ver arriba.
- Las invitaciones no asignan roles ni se pueden reenviar/consultar por el token; reinvitar emite una nueva y revoca las anteriores. No hay listado paginado (las últimas 100).
- La invitación y el desafío usan `now()` de la aplicación y la base de datos de la app; relojes desfasados entre procesos afectan la caducidad.
- Como en 0005, un proyecto generado ANTES de 0005 no tiene el filtro `passwordApps()` de `tests-auth`; solo importa para apps `otp` (con `invitations`+`otp`): las apps `mfa` conservan `signin` y `change-password`, así que `AuthFlowTest` las sigue recorriendo sin cambios.
- `mfa-deps` ejecuta `sh -c`; asume un entorno POSIX (el generador ya asume `sh`/`composer`/`pnpm` en el PATH).
