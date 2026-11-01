# Seguridad

- Autorización siempre en el backend. Las rutas protegidas van detrás del middleware de autenticación con su guard explícito (`auth` + nombre del guard); el permiso concreto lo comprueba el repositorio (`HasAuthorizable`). Ownership por fila: `HasBelongsToOwner` solo escopa si la tabla tiene una columna de dueño reconocida; verifícalo, no lo asumas.
- Los guards están aislados por provider. Un token de una app debe fallar con 401 en las demás (test `tests/Feature/GuardIsolationTest.php`; no lo debilites).
- Passport necesita un cliente de acceso personal POR provider; sin él `createToken()` falla. Lo crea `php artisan authentications:setup`.
- Verifica la firma y `iss`/`aud`/`exp` de cualquier `id_token` (social/nativo) contra el JWKS del emisor (`packages/shardevcom/integrations`). Un proveedor desconocido se RECHAZA; nunca decodifiques un JWT sin verificar ni uses un email enviado por el cliente como identidad.
- Valida con FormRequest y consume solo `->validated()`. Nunca hagas fillable ni valides desde el cliente columnas de dueño o rol (`owner_id`, `user_id`, `guard`, `active`...).
- Limita con `throttle` toda ruta de login, OTP, pagos o mutación de cuenta.
- No registres tokens, contraseñas, códigos ni cuerpos de petición completos. Registra identificadores y resultados.
- XML de fuentes no confiables: nunca habilites `LIBXML_NOENT`/`LIBXML_DTDLOAD`.
- Dependencias: ejecuta `composer audit` y `pnpm audit` antes de añadir una de áreas sensibles.
