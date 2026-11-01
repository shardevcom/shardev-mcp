<?php

return [
    // Guard Bearer de la app principal; las demás apps tienen el suyo en config/auth.php.
    'guard' => env('PASSPORT_GUARD', '{{ project.primary_app }}'),
    // Llaves por variable de entorno (útil en contenedores); si faltan se leen de storage/oauth-*.key.
    'private_key' => env('PASSPORT_PRIVATE_KEY'),
    'public_key' => env('PASSPORT_PUBLIC_KEY'),
    'connection' => env('PASSPORT_CONNECTION'),
];
