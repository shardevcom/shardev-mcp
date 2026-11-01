<?php

use {{ app.social_controller_class }};
use Illuminate\Support\Facades\Route;

/*
| Login social de la app `{{ app.key }}` -> /api/{{ app.key }}/auth/social/...
| El camino central es POST auth/social/{provider} con un `id_token`: lo usa el SPA tras volver del proveedor y
| lo usará el cliente nativo. `{provider}` solo admite los de config/social_{{ app.key }}.php; otro valor es un 404.
*/
Route::prefix('{{ app.key }}')->as('{{ app.key }}.')->group(function () {
    Route::get('auth/social/providers', [{{ app.model }}SocialController::class, 'providers'])
        ->middleware('throttle:30,1,social-providers-{{ app.key }}')
        ->name('social.providers');

    Route::post('auth/social/{provider}', [{{ app.model }}SocialController::class, 'login'])
        ->whereIn('provider', [{{ app.social_providers_php }}])
        ->middleware('throttle:10,1,social-login-{{ app.key }}')
        ->name('social.login');

    // Vincular una identidad a la cuenta YA autenticada (la cuenta sale del token, nunca del cuerpo).
    Route::post('auth/social/{provider}/link', [{{ app.model }}SocialController::class, 'link'])
        ->whereIn('provider', [{{ app.social_providers_php }}])
        ->middleware(['auth:{{ app.api_guard }}', 'throttle:10,1,social-link-{{ app.key }}'])
        ->name('social.link');
});
