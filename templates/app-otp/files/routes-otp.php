<?php

use {{ app.otp_controller_class }};
use Illuminate\Support\Facades\Route;

/*
| Login por código de la app `{{ app.key }}` -> /api/{{ app.key }}/auth/otp/...
| Son públicas por diseño, así que cada una lleva su propio throttle (contador por IP separado, gracias
| al tercer parámetro). Además el servicio limita por correo, y el paquete `verification` por código.
*/
Route::prefix('{{ app.key }}')->as('{{ app.key }}.')->group(function () {
    Route::post('auth/otp/request', [{{ app.model }}OtpController::class, 'requestCode'])
        ->middleware('throttle:6,1,otp-request-{{ app.key }}')
        ->name('otp.request');

    Route::post('auth/otp/verify', [{{ app.model }}OtpController::class, 'verifyCode'])
        ->middleware('throttle:10,1,otp-verify-{{ app.key }}')
        ->name('otp.verify');
});
