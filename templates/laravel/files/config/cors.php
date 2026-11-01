<?php

/*
| CORS con lista blanca de orígenes por entorno. NUNCA `*` junto con credenciales: define los
| orígenes exactos de tus SPAs en CORS_ALLOWED_ORIGINS (separados por coma).
*/

$origins = array_values(array_filter(array_map('trim', explode(',', (string) env('CORS_ALLOWED_ORIGINS', env('APP_URL', ''))))));

if (in_array('*', $origins, true)) {
    throw new RuntimeException('CORS_ALLOWED_ORIGINS no admite "*": lista los orígenes exactos.');
}

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => $origins,
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    'exposed_headers' => [],
    'max_age' => 600,
    // La API se autentica con Bearer, no con cookies: no se necesitan credenciales cross-origin.
    'supports_credentials' => false,
];
