<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Auth;
use Shardevcom\Supports\Auth\Authentication;
use Shardevcom\Supports\Contracts\AuthenticationInterface;

/**
 * Class AuthHelper
 *
 * Helper centralizado para la gestión, resolución y abstracción del contexto
 * de autenticación de la plataforma, compatible con múltiples guards y entornos (Web, API, CLI, Tests).
 *
 * @package Shardevcom\Supports\Helpers
 */
class AuthHelper
{
    /**
     * Obtiene la instancia del usuario autenticado en el contexto de la petición actual.
     *
     * @return \Illuminate\Contracts\Auth\Authenticatable|null Instancia del usuario o null si no está autenticado.
     */
    public static function user(): ?Authenticatable
    {
        // Request HTTP real (API/Web)
        $user = request()?->user();

        if ($user) {
            return $user;
        }

        // Fallback para tests / CLI autenticado
        return Auth::user();
    }

    /**
     * Obtiene el identificador único (ID) del usuario autenticado.
     *
     * @return int|string|null ID del usuario (numérico o UUID) o null si no hay sesión activa.
     */
    public static function id(): int|string|null
    {
        return self::user()?->getAuthIdentifier();
    }

    /**
     * Obtiene el FQCN (Fully Qualified Class Name) del modelo de usuario autenticado.
     * Ejemplo: "App\Models\Admin"
     *
     * @return string|null Nombre de clase completo o null si no hay sesión activa.
     */
    public static function model(): ?string
    {
        return self::user()
            ? get_class(self::user())
            : null;
    }

    /**
     * Obtiene el nombre corto (alias) del modelo de usuario autenticado sin el namespace.
     * Ejemplo: "admin", "user"
     *
     * @return string|null Nombre corto del modelo o null si no hay sesión activa.
     */
    public static function type($user = null): ?string
    {
        if (is_object($user)) {
            return class_basename(get_class($user));
        }

        $user = $user ?? self::user();

        return $user ? class_basename($user) : null;
    }

    /**
     * Obtiene el nombre del Guard/Driver de autenticación por defecto que resolvió Laravel.
     * Ejemplo: "api", "web", "admin"
     *
     * @return string|null Nombre del driver del guard actual.
     */
    public static function guard(): ?string
    {
        return Auth::getDefaultDriver();
    }

    /**
     * Determina si existe un usuario autenticado en el contexto actual.
     *
     * @return bool True si el usuario está logueado, false en caso contrario.
     */
    public static function check(): bool
    {
        return !empty(self::user());
    }

    /**
     * Comprueba si el usuario autenticado posee un rol específico (Spatie Permissions/Custom).
     *
     * @param string $role Nombre del rol a verificar (ej: "admin", "editor").
     * @return bool True si cuenta con el rol, false si no lo tiene o el modelo no implementa la verificación.
     */
    public static function hasRole(string $role): bool
    {
        $user = self::user();

        if (!$user || !method_exists($user, 'hasRole')) {
            return false;
        }

        return $user->hasRole($role);
    }

    /**
     * Evalúa si las políticas de seguridad y scopes de base de datos deben aplicar filtros contextuales.
     * Desactiva de forma inteligente el filtrado si la ejecución proviene de CLI (Cron, Queue, Artisan) o Unit Tests.
     *
     * @return bool True si se deben inyectar restricciones de consulta a la base de datos.
     */
    public static function shouldFilter(): bool
    {
        /**
         * Consola real:
         * - artisan
         * - queues
         * - scheduler
         */
        if (App::runningInConsole()) {

            /**
             * PHPUnit NO debe entrar aquí
             */
            if (!App::runningUnitTests()) {
                return false;
            }
        }

        return static::check();
    }

    /**
     * Resuelve tipos de columnas que puede albergar o relacionar un usuario
     *
     * @return array
     */
    public static function ownerColumns(): array
    {
        return [
            'user_id',
            'admin_id',
            'accountable_id',
            'created_by',
            'updated_by',
            'author_id',
            'creator_id',
        ];
    }

    /**
     * Resuelve y empaqueta el estado completo de la sesión actual en un mapa estructural.
     * Útil para logs de auditoría, payloads de eventos o payloads JWT corporativos.
     *
     * @return AuthenticationInterface
     */
    public static function resolve(): AuthenticationInterface
    {
        $user = self::user();

        return new Authentication(
            id: $user?->getAuthIdentifier(),
            type: self::type($user),
            guard: self::guard(),
            user: $user,
        );
    }
}
