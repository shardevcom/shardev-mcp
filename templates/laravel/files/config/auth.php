<?php

/*
| Un PAR de guards por app:
|   - guard Bearer (driver passport): lo usa el SPA. Es el nombre de la app (web, adm...).
|   - guard de sesión: para vistas servidas por Laravel.
| Cada par apunta al provider de su app; un token de una app NO sirve en otra.
| El generador añade las entradas de cada app en las líneas `shardev:`.
*/

return [

    'defaults' => [
        'guard' => env('AUTH_GUARD', '{{ project.primary_session_guard }}'),
        'passwords' => env('AUTH_PASSWORD_BROKER', '{{ project.primary_provider }}'),
    ],

    'guards' => [
        // shardev:guards
    ],

    'providers' => [
        // shardev:providers
    ],

    'passwords' => [
        '{{ project.primary_provider }}' => [
            'provider' => '{{ project.primary_provider }}',
            'table' => env('AUTH_PASSWORD_RESET_TOKEN_TABLE', 'password_reset_tokens'),
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),

];
