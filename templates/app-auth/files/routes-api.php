<?php

use {{ app.controller_class }};
use Illuminate\Support\Facades\Route;
use Shardevcom\Authentications\Http\Controllers\PermissionController;
use Shardevcom\Authentications\Http\Controllers\RoleController;

/*
| API de la app `{{ app.key }}` -> /api/{{ app.key }}/...  (guard Bearer `{{ app.api_guard }}`).
| Solo signin es público (con throttle). Lo demás exige un token DE ESTA APP: un token de otra
| app se rechaza con 401 porque su cliente Passport pertenece a otro provider.
{{#if app.feature.mfa}}
|
| Esta app tiene MFA (feature mfa): `signin` devuelve un desafío en vez del token a las cuentas con segundo
| factor (ver routes/api/{{ app.key }}-mfa.php).
{{/if}}
{{#if app.feature.otp}}
|
| Esta app entra por código (feature otp): NO hay signin ni change-password por contraseña (ver
| routes/api/{{ app.key }}-otp.php). La columna password existe pero solo guarda un hash aleatorio.
{{/if}}
*/
Route::prefix('{{ app.key }}')->as('{{ app.key }}.')->group(function () {
{{#if !app.feature.otp}}
    Route::post('auth/signin', [{{ app.model }}AuthController::class, 'signin'])
        ->middleware('throttle:auth-login')
        ->name('signin');
{{/if}}

    Route::middleware('auth:{{ app.api_guard }}')->group(function () {
        Route::post('logout', [{{ app.model }}AuthController::class, 'logout'])->name('logout');

        // Perfil: siempre de la cuenta autenticada, nunca de un id del cliente.
        Route::get('profile', [{{ app.model }}AuthController::class, 'me'])->name('profile.show');
        Route::match(['put', 'patch'], 'profile', [{{ app.model }}AuthController::class, 'updateProfile'])->name('profile.update');
{{#if !app.feature.otp}}
        Route::post('auth/change-password', [{{ app.model }}AuthController::class, 'changePassword'])
            ->middleware('throttle:10,1')
            ->name('change-password');
{{/if}}

        // Roles y permisos: el permiso (`list:roles`, `create:roles`...) lo comprueba el repositorio.
        Route::prefix('roles')->as('roles.')->group(function () {
            Route::delete('bulk-delete', [RoleController::class, 'bulkDestroy'])->name('bulk.destroy');
            Route::post('bulk-update', [RoleController::class, 'bulkUpdate'])->name('bulk.update');
            Route::get('export', [RoleController::class, 'export'])->name('export');
            Route::post('import', [RoleController::class, 'import'])->name('import');
            Route::get('/', [RoleController::class, 'index'])->name('index');
            Route::get('{id}', [RoleController::class, 'show'])->name('show');
            Route::post('/', [RoleController::class, 'store'])->name('store');
            Route::match(['put', 'patch'], '{id}', [RoleController::class, 'update'])->name('update');
            Route::delete('{id}', [RoleController::class, 'destroy'])->name('destroy');
        });

        Route::prefix('permissions')->as('permissions.')->group(function () {
            Route::match(['put', 'patch'], 'role/{id}', [PermissionController::class, 'updatePermissionRole'])->name('role.update');
            Route::get('/', [PermissionController::class, 'index'])->name('index');
            Route::get('{id}', [PermissionController::class, 'show'])->name('show');
        });
    });
});
