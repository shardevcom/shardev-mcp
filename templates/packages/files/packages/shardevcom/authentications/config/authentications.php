<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Apps con login propio
    |--------------------------------------------------------------------------
    | Cada app del proyecto declara su par de guards (token Passport + sesión), su provider y su
    | modelo. El proyecto sobrescribe esta clave en config/authentications.php (una entrada por app):
    |
    |   'adm' => [
    |       'guard'         => 'adm',     // Bearer (Passport): lo que usa el SPA
    |       'session_guard' => 'admin',   // sesión (web)
    |       'provider'      => 'admins',  // clave en config/auth.php `providers`
    |       'model'         => \App\Models\Admin::class,
    |   ],
    */
    'apps' => [],

    /*
    |--------------------------------------------------------------------------
    | Tokens Passport
    |--------------------------------------------------------------------------
    | Vida explícita: el valor por defecto de Passport es de un año.
    */
    'tokens' => [
        'name' => 'Personal Access Token',
        'access_hours' => (int) env('PASSPORT_ACCESS_TTL_HOURS', 24),
        'refresh_days' => (int) env('PASSPORT_REFRESH_TTL_DAYS', 30),
        'personal_months' => (int) env('PASSPORT_PERSONAL_TTL_MONTHS', 6),
    ],

    /*
    |--------------------------------------------------------------------------
    | Rate limiting del login
    |--------------------------------------------------------------------------
    | Intentos por minuto por (email + IP) en `signin`.
    */
    'login_attempts_per_minute' => (int) env('LOGIN_ATTEMPTS_PER_MINUTE', 6),
];
