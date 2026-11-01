<?php

/*
| Segundo factor (TOTP) de la app `{{ app.key }}`. Nada de esto viene del cliente.
*/
return [
    // Nombre que muestra la app autenticadora junto a la cuenta.
    'issuer' => env('MFA_ISSUER', config('app.name')),

    // Vida del desafío que sigue a una contraseña correcta, en segundos. Un solo uso.
    'challenge_ttl_seconds' => 300,

    // Intentos de código por desafío (incluido el correcto). Agotados, hay que volver a iniciar sesión.
    'challenge_max_attempts' => 5,

    // Fallos de código por cuenta en la ventana: pasado el tope no se aceptan más códigos (cualquier desafío).
    'account_max_failures' => 10,
    'account_failure_window_minutes' => 15,

    // Pasos TOTP de tolerancia a cada lado del actual (1 = +-30 s).
    'window' => 1,

    // Longitud del secreto base32 (32 = 160 bits) y cantidad de códigos de recuperación.
    'secret_length' => 32,
    'recovery_codes' => 10,
];
