<?php

namespace Shardevcom\Authentications\Support;

use InvalidArgumentException;

/**
 * Lee `config('authentications.apps')`. Es la única fuente de qué apps existen: una app que no
 * está aquí no puede iniciar sesión por este paquete.
 */
class AppRegistry
{
    /** @return array{guard:string,session_guard:string,provider:string,model:class-string} */
    public static function get(string $key): array
    {
        $app = config("authentications.apps.{$key}");

        if (! is_array($app)) {
            throw new InvalidArgumentException("La app [{$key}] no está declarada en config/authentications.php.");
        }

        return $app;
    }

    /** @return array<string, array{guard:string,session_guard:string,provider:string,model:class-string}> */
    public static function all(): array
    {
        return (array) config('authentications.apps', []);
    }

    /** Proveedores (config/auth.php) de los guards Passport de las apps, sin repetir. */
    public static function providers(): array
    {
        return array_values(array_unique(array_map(fn (array $a) => $a['provider'], self::all())));
    }
}
