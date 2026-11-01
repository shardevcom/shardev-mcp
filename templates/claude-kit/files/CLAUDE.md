# CLAUDE.md - {{ project.name }}

Guía de entrada para agentes de IA. Las reglas detalladas viven en `.claude/rules/`. El código actual es la fuente de verdad: si este archivo y el código discrepan, gana el código; corrige el archivo.

## Qué es

Aplicación Laravel 13 (PHP 8.3+, Octane/RoadRunner) con un SPA React 19 + Vite + Tailwind v4 por app (`resources/react/<app>`), organizada como monolito modular: la lógica de dominio vive en paquetes propios de `packages/shardevcom/*` (copias locales, con su hash registrado en `.ops/lock.yaml`).

- Apps: ver `config/authentications.php` (una entrada por app, cada una con su par de guards (token Passport y sesión)).
- Autenticación: Passport con un cliente de acceso personal por provider (`php artisan authentications:setup`, idempotente; ejecútalo tras migrar en cada entorno).
- Autorización: Spatie permission, comprobada en el backend (`HasAuthorizable` en repositorios). Roles y matriz en `config/shardevcom.php`.

## Comandos

- Backend: `composer install`, `php artisan migrate`, `php artisan authentications:setup`, `php artisan db:seed`, `php artisan test`.
- Primera cuenta de una app: `php artisan authentications:create-account <app> <email> --role=admin` (pide la contraseña en modo oculto).
- Frontend: `pnpm install`, `pnpm run types`, `pnpm run build`, `pnpm run dev:<app>`.
- Octane en local: `vendor/bin/rr get-binary` (descarga RoadRunner; el binario no se versiona) y `php artisan octane:start --server=roadrunner`.

## Reglas que no se negocian

1. Ocultar algo en el frontend nunca es autorización: se aplica en el backend en cada petición.
2. Nunca confíes en un id enviado por el cliente (usuario, dueño, tenant): resuélvelo del principal autenticado.
3. Sin secretos en el repositorio ni en logs. `.env` no se versiona; `.env.example` lleva los secretos vacíos. Un secreto requerido ausente debe hacer fallar el arranque, sin valor de reserva.
4. CORS con lista blanca de orígenes (`CORS_ALLOWED_ORIGINS`), nunca `*` con credenciales.
5. Un cambio de autorización o seguridad lleva pruebas del caso permitido Y del rechazado.
6. Trabaja en una rama de trabajo; no edites la rama de producción directamente. No ejecutes despliegues, migraciones de producción ni cambios de infraestructura sin autorización explícita.

Más detalle: `.claude/rules/architecture.md`, `security.md`, `laravel.md`, `frontend.md`, `testing.md`.
