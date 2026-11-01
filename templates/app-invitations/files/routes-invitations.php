<?php

use {{ app.invitation_controller_class }};
use Illuminate\Support\Facades\Route;

/*
| Invitaciones de la app `{{ app.key }}`. Alta cerrada: esta app no tiene registro público; las cuentas nacen
| de aceptar una invitación (`auth/invitations/accept`, pública por diseño: el token es la credencial).
| Crear, listar y revocar exigen un token DE ESTA APP y, además, el permiso `<acción>:invitations` del guard
| `{{ app.api_guard }}` (lo comprueba el servicio en cada petición). Cada ruta lleva su propio throttle.
*/
Route::prefix('{{ app.key }}')->as('{{ app.key }}.')->group(function () {
    Route::post('auth/invitations/accept', [{{ app.model }}InvitationController::class, 'accept'])
        ->middleware('throttle:10,1,invitation-accept-{{ app.key }}')
        ->name('invitations.accept');

    Route::middleware('auth:{{ app.api_guard }}')->group(function () {
        Route::get('invitations', [{{ app.model }}InvitationController::class, 'listInvitations'])
            ->middleware('throttle:30,1,invitation-list-{{ app.key }}')
            ->name('invitations.index');
        Route::post('invitations', [{{ app.model }}InvitationController::class, 'createInvitation'])
            ->middleware('throttle:20,1,invitation-create-{{ app.key }}')
            ->name('invitations.store');
        Route::delete('invitations/{id}', [{{ app.model }}InvitationController::class, 'revokeInvitation'])
            ->whereNumber('id')
            ->middleware('throttle:30,1,invitation-revoke-{{ app.key }}')
            ->name('invitations.destroy');
    });
});
