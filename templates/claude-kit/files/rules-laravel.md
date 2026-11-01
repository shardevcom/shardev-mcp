# Laravel

- Controladores: extienden `Shardevcom\Supports\Controllers\Controller` para CRUD y definen `$requestClass`. Sin lógica de negocio ni consultas directas.
- Modelos: `$fillable` explícito, nunca `$guarded = []`; oculta credenciales en `$hidden`.
- Dinero o estados que cambian por concurrencia: `DB::transaction()` con `lockForUpdate()` y una restricción única en base de datos.
- Todo lo que habla con un sistema externo va a cola, con `$tries`/`$timeout` y de forma idempotente.
- Registra listeners en el `ServiceProvider` del paquete dueño; no uses listeners comodín (`'*'`).
- Comandos que mutan datos: guarda por entorno o pide `--force`.
- Los errores de `/api/*` salen con el formato de `JsonResponse`; en producción el mensaje real no se filtra.
