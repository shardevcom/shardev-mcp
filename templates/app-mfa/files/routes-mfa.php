<?php

use {{ app.mfa_controller_class }};
use Illuminate\Support\Facades\Route;

/*
| Segundo factor (TOTP) de la app `{{ app.key }}` -> /api/{{ app.key }}/auth/mfa/...
| `auth/signin` (routes/api/{{ app.key }}.php) devuelve un desafío en vez de un token a las cuentas con MFA.
| `verify` es público por diseño (el desafío es la credencial); el resto exige un token DE ESTA APP. Todas llevan
| su propio throttle (contador por IP separado gracias al tercer parámetro); además el servicio limita por
| desafío y por cuenta.
*/
Route::prefix('{{ app.key }}')->as('{{ app.key }}.')->group(function () {
    Route::post('auth/mfa/verify', [{{ app.model }}MfaController::class, 'verify'])
        ->middleware('throttle:10,1,mfa-verify-{{ app.key }}')
        ->name('mfa.verify');

    Route::middleware('auth:{{ app.api_guard }}')->group(function () {
        Route::get('auth/mfa', [{{ app.model }}MfaController::class, 'status'])
            ->middleware('throttle:30,1,mfa-status-{{ app.key }}')
            ->name('mfa.status');
        Route::post('auth/mfa/setup', [{{ app.model }}MfaController::class, 'setup'])
            ->middleware('throttle:5,1,mfa-setup-{{ app.key }}')
            ->name('mfa.setup');
        Route::post('auth/mfa/confirm', [{{ app.model }}MfaController::class, 'confirm'])
            ->middleware('throttle:10,1,mfa-confirm-{{ app.key }}')
            ->name('mfa.confirm');
        Route::post('auth/mfa/disable', [{{ app.model }}MfaController::class, 'disable'])
            ->middleware('throttle:5,1,mfa-disable-{{ app.key }}')
            ->name('mfa.disable');
        Route::post('auth/mfa/recovery-codes', [{{ app.model }}MfaController::class, 'recoveryCodes'])
            ->middleware('throttle:5,1,mfa-recovery-{{ app.key }}')
            ->name('mfa.recovery-codes');
    });
});
