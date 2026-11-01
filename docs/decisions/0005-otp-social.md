# 0005 - Features `otp` y `social` (primeras capas opcionales)

Fecha: 2026-11-01. Alcance: las dos primeras capas de feature por app. Fuera de alcance: `mfa`, `invitations`, Capacitor, `ui_*`, AWS, el almacenamiento de tokens de `@shardev/common`, añadir una feature a una app que ya existe.

Origen: del proyecto de referencia solo se tomó el comportamiento esperado de un login por código y de un login social; no se copió código.

## Cómo se pide

`features: ["otp"]`, `["social"]` o ambas, por app, tanto en el spec de `project_create` como en `app_plan`/`app_create` (`--features otp,social --social-providers google,microsoft,apple --auto-register` en la CLI). `social` exige `social_providers` (solo `google`, `microsoft`, `apple`: los que tienen verificador en `integrations`). `auto_register` (por defecto `false`) permite crear la cuenta en el primer login válido de OTP o social; sin `otp` ni `social` es un error.

`mfa` e `invitations` siguen rechazadas con "la capa de la feature ... todavía no existe". Ya no hay una lista aparte de features futuras: una feature se acepta si hay una capa de app con `when: app.feature.<x>`; si no, `buildOutputs` falla. Un nombre desconocido se rechaza por el esquema.

## Capas

| Capa | Scope | Orden | Contenido (por app con la feature) |
|---|---|---|---|
| `app-otp` | app, `app.feature.otp` | 35 | `app/Auth/Otp/`: controlador, servicio, dos requests y mailable; vista del correo; `config/otp_<key>.php`; `routes/api/<key>-otp.php`. |
| `app-social` | app, `app.feature.social` | 36 | `app/Auth/Social/`: controlador, servicio, request y modelo de identidad; migración `<tabla>_social_identities`; `config/social_<key>.php`; `routes/api/<key>-social.php`. |
| `tests-otp`, `tests-social` | app | 41, 42 | `tests/Feature/<Modelo>OtpLoginTest.php` y `<Modelo>SocialLoginTest.php`, solo si la feature está. |
| `app-react-otp`, `app-react-social` | app | 51, 52 | `pages/auth/sign-in/otp-form.tsx` y `social-buttons.tsx` dentro del SPA de esa app. Nada compartido entre apps. |

Son capas `scope: app`: funcionan igual desde `project_create` y desde `app_create` (que nunca re-renderiza capas de proyecto). Por eso todo lo que necesitan va en archivos con la `key` en el nombre y no hay archivos compartidos entre apps.

### Cableado y cambios a plantillas existentes

El diseño original era "solo por anclas". Una feature que *quita* algo (el login por contraseña) o que cambia el contenido de una página no puede hacerlo con una inserción, así que se usaron bloques `{{#if app.feature.x}}` dentro de plantillas existentes. Con la feature apagada el bloque no deja rastro: se comparó la generación de un proyecto sin features antes y después (misma lista de 344 archivos, mismos hashes) y las únicas diferencias son `.ops/lock.yaml` (cambia `template_hash` y el spec trae `auto_register: false`), el `.env` (secretos aleatorios) y dos pruebas que se generalizaron a propósito:

- `app-auth/routes-api.php`: sin `signin` ni `change-password` si la app tiene `otp`.
- `app-react/.../sign-in/index.tsx` y `.../profile/index.tsx`: el login por código reemplaza al formulario de contraseña, los botones sociales se añaden, y el perfil no ofrece cambiar la contraseña en apps `otp`. Sin feature, el archivo generado es idéntico.
- `tests-auth/.../Concerns/AuthApps.php` y `AuthFlowTest.php` (cambian en todos los proyectos): las pruebas de login y de cambio de contraseña recorren `passwordApps()` (apps que registran `<key>.signin`) en vez de todas las apps. Es necesario porque esas pruebas ya existen en proyectos que luego reciben una app `otp` por `app_create`. Un proyecto generado ANTES de este cambio no tiene ese filtro: añadirle una app `otp` haría fallar su `AuthFlowTest` (hay que actualizar esas dos pruebas a mano).

No se necesitaron variables de entorno nuevas: `GOOGLE_*`, `MICROSOFT_*` y `APPLE_*` ya estaban (vacías, sin valores por defecto salvo `MICROSOFT_TENANT=consumers`) en `.env.example`, `env.schema` y `config/services.php`. No hay flujo de código de autorización, así que los secretos de cliente no se usan.

### Motor

- `APP_FEATURES` = `mfa, invitations, otp, social`; `SOCIAL_PROVIDERS` = `google, microsoft, apple` (antes admitía `facebook` y `github`, sin verificador).
- Variables nuevas por app: `key_upper`, `auto_register`, `social_providers_php` y cuatro nombres de clase ya compuestos (el renderer trata `\{{` como escape, así que `App\Auth\Otp\{{ app.model }}...` no se puede escribir).
- `assertFeatureLayers` en `buildOutputs` (ver arriba). `AppPlanInputSchema` acepta `social_providers` y `auto_register`.

## OTP: decisiones

**Contraseña.** Una app con `otp` es sin contraseña: no se registran `auth/signin` ni `auth/change-password` (404). La columna `password` sigue siendo `NOT NULL` y la migración, el modelo y `Account` no cambian, así que los demás apps no se ven afectados; las cuentas creadas por OTP o social guardan un hash de 64 caracteres aleatorios que nunca se revela. La fábrica de pruebas sí pone una contraseña conocida (solo para pruebas). Alternativa descartada: dejar la ruta de contraseña y rechazarla en el controlador (un endpoint muerto que sigue siendo superficie de ataque).

**Sin segunda implementación de OTP.** `<Modelo>OtpService` implementa `VerificationChannelInterface` y se pasa a `VerificationManager` del paquete `verification`; este hace el hash del código, la caducidad, el tope de intentos y el enfriamiento. El servicio solo decide qué cuentas pueden pedir código, envía el correo y emite el token. (El `EmailChannel` del paquete no sirve: referencia un mailable de aplicación que no existe, ver "Limitaciones conocidas".)

| Requisito | Cómo |
|---|---|
| Hash en reposo | `Hash::make` del paquete; la prueba lo comprueba en la tabla. |
| Caducidad | `verification.ttl` (10 min). |
| Bloqueo por intentos | `verification.attempts.max` (5) por código, más 10 verificaciones por correo y 15 min en el servicio. Pedir otro código exige esperar el enfriamiento y hay tope de 5 códigos por correo y hora. |
| Enfriamiento de reenvío | `verification.resend_cooldown` (60 s); se absorbe en silencio (no revela nada). |
| `throttle` en las rutas | `throttle:6,1,otp-request-<key>` y `throttle:10,1,otp-verify-<key>`. El tercer parámetro separa los contadores (sin él, todos los `throttle:N,M` numéricos comparten contador por IP). Son numéricos y no limiters con nombre porque un limiter definido en el archivo de rutas no existe con `route:cache`. |
| Un solo uso | El desafío pasa a verificado y además se invalida con un `UPDATE ... WHERE invalidated_at IS NULL`; si no afecta exactamente una fila (dos peticiones simultáneas con el código bueno) la segunda falla. |
| Misma respuesta exista o no el correo | Pedir código responde siempre 202 con cuerpo fijo; el envío ocurre con `defer()` después de responder, así que tampoco el tiempo delata. Verificar: cualquier fallo es el mismo 401; sin desafío se gasta un `Hash::check` ficticio. Cuenta inactiva = cuenta inexistente. |
| Sin código en logs ni respuestas | Solo se registra la clase de la excepción. El mailable no es `ShouldQueue` (la cola guardaría el código en claro). Con `MAIL_MAILER=log` el *transporte* escribe el correo entero en el log: es el modo de desarrollo; en producción el servicio se niega a emitir códigos si el mailer es `log` o `array`. |
| Aislamiento entre apps | El propósito del desafío es `login:<key>`; un código de otra app no existe para esta. |
| Cuentas nuevas | Solo con `auto_register: true`. Sin él, un correo sin cuenta no recibe código y aunque exista un desafío no crea nada. Las cuentas creadas no reciben roles: el dueño decide el rol por defecto. |

Riesgo residual: un código de 6 dígitos hasheado con bcrypt se puede adivinar sin conexión si se filtra la base de datos durante sus 10 minutos de vida. Con `auto_register` activo cualquiera puede hacer que se envíe un correo a una dirección ajena (limitado por el tope por correo/hora y por el throttle por IP).

## Social: decisiones

Camino central: `POST /api/<key>/auth/social/{provider}` con `{ "id_token": "..." }` (el cliente nativo usará el mismo). `{provider}` está restringido por la ruta a los de la app: cualquier otro valor es 404 aunque esté configurado. Más `GET .../auth/social/providers` (client ids públicos para el SPA) y `POST .../auth/social/{provider}/link` (con la cuenta ya autenticada).

- **Verificación.** Siempre con los verificadores de `integrations` (firma contra el JWKS del emisor, `iss`, `aud`, `exp`). No hay decode base64 de reserva. El cuerpo solo se valida por `id_token`: ni correo, ni id de usuario.
- **Google.** El verificador de `integrations` solo acepta `GOOGLE_NATIVE_CLIENT_ID` como audiencia. Para admitir también el client id web se usa una subclase anónima que reemplaza solo `assertValidClaims` (mismo `iss`, audiencia en `{GOOGLE_CLIENT_ID, GOOGLE_NATIVE_CLIENT_ID}`); firma y expiración siguen siendo las del original. Microsoft y Apple usan los verificadores tal cual (Apple con cada audiencia configurada: bundle y service id).
- **`exp` obligatorio.** `JWT::decode` solo valida `exp` si viene; el servicio lo exige y exige un `sub` de texto de hasta 255 caracteres.
- **Nonce.** Sin nonce en el backend: el servidor no los emite y uno elegido por el cliente se puede omitir. El SPA genera `state` y `nonce`, los guarda en `sessionStorage` y al volver exige que el `state` coincida y que el id_token traiga ese `nonce` antes de enviarlo.
- **Tabla por app.** `<tabla>_social_identities` (FK a la tabla de la app con `ON DELETE CASCADE`, `UNIQUE(provider, subject)`, `UNIQUE(account_id, provider)`). La misma identidad en otra app es otra fila en otra tabla: no cruza guards. La migración usa FK sin alternativa; en una app `existing` cuya tabla se cree en una migración posterior a `2026_01_01_000200` falla en voz alta y hay que reordenar (sin FK, un id de cuenta reutilizado heredaría la identidad). La audiencia es del proyecto (config de `services`), no de la app; el aislamiento es la tabla.
- **Cómo se resuelve la cuenta.** (1) identidad ya vinculada -> esa cuenta; (2) sin vínculo y con correo verificado por el proveedor -> cuenta con ese correo (sin distinguir mayúsculas), solo si está activa y no tiene ya otra identidad del mismo proveedor; (3) sin cuenta -> se crea solo con `auto_register`; (4) en cualquier otro caso, 401 genérico. Un correo no verificado nunca enlaza.
- **Claims en los que se apoya cada proveedor.** Google: `sub`, `email`, `email_verified` (bool o `"true"`). Apple: `sub`, `email`, `email_verified` (bool o `"true"`). Microsoft: solo `sub`; su `email` no se usa para enlazar porque Entra ID no lo garantiza verificado, así que la primera vinculación de Microsoft es con `link` (cuenta autenticada). `link` rechaza (409 genérico) una identidad ya vinculada a otra cuenta o una cuenta que ya tiene otra del mismo proveedor.
- **Registros.** Solo `app`, `provider` y la clase de la excepción, nunca el token ni claims.
- **SPA.** Botones de Google y Microsoft con redirección `response_type=id_token` (sin SDKs). Apple no se ofrece en el navegador: su flujo web exige un receptor `form_post` en el servidor, que no se incluyó; Apple entra por el endpoint con el id_token de un cliente nativo. No hay flujo de código de autorización ni receptor de redirección en el backend.

## Pruebas generadas

Con la feature presente, en `tests/Feature/` de la app (permitido y rechazado). OTP: código correcto, mayúsculas, incorrecto, hash en reposo y respuesta sin código, bloqueo, caducado, reutilizado, mismo resultado para correo inexistente/inactivo/enfriamiento, código de otra app, throttle, ausencia de rutas de contraseña, sin código en logs, y creación de cuenta según `auto_register`. Social: token válido, entrada por vínculo, firma falsificada, `alg: none`, confusión HS256, audiencia/emisor/expiración/`exp` ausente, JWKS caído (falla cerrado), proveedor desconocido o no habilitado, token mal formado, correo sin verificar, Microsoft sin enlace por correo, correo del cuerpo ignorado, cuenta inactiva, no reasignar por correo, identidad y token que no cruzan apps ni guards, `link` autenticado y con conflicto, throttle, sin token en logs, y `auto_register`. Las llaves se generan en cada ejecución (nada se versiona) y cada JWKS se sirve con `Http::fake` más `preventStrayRequests()`: ninguna prueba toca a un proveedor real.

## Qué NO se verificó

- Ningún proveedor real (Google, Microsoft, Apple) ni entrega real de correo. Los botones sociales y el formato de la URL de autorización no se probaron contra un proveedor; el SPA solo pasó tipos y build, no se abrió en un navegador. El flujo `response_type=id_token` de Microsoft y Google sigue siendo válido según sus documentos, pero no se ejecutó.
- `defer()` bajo Octane/RoadRunner (se probó con el kernel de pruebas).
- MySQL (las pruebas usan SQLite).
- `composer audit` de un proyecto generado: no se añadió ninguna dependencia PHP ni npm nueva.

## Limitaciones conocidas de este proyecto (fuera de alcance, no se tocaron)

- `verification`: `Channels/EmailChannel` usa `App\Mail\VerificationCodeMail`, que no existe en el proyecto generado; el canal por defecto fallaría (por eso las features usan su propio canal). Las rutas `/api/verification/*` quedan protegidas por `auth:${VERIFICATION_GUARD}` (por defecto `web`), que solo existe si hay una app con ese guard.
- `integrations`: los servicios JWKS de Google y Microsoft usan `Cache::remember` sobre `Http::get(...)->json() ?? []`: una respuesta de error o vacía se cachea una hora (indisponibilidad hasta que expire). `MicrosoftOidcConfiguration` fija un solo tenant: un token de otro tenant se rechaza por `iss`.
- `AccountAuthService::issueToken` es privado: las features reimplementan la llamada a `AccountResource::withToken`.
