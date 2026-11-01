<?php

namespace App\Auth\Invitations;

use Illuminate\Http\Request;
use Shardevcom\Authentications\Http\Controllers\AccountAuthController;
use Shardevcom\Authentications\Services\AccountAuthService;

/**
 * Invitaciones de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). El invitador sale SIEMPRE del token
 * (`$request->user($guard)`), nunca del cuerpo; el permiso se comprueba en el servidor en cada petición.
 */
class {{ app.model }}InvitationController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';

    public function __construct(AccountAuthService $auth, private {{ app.model }}InvitationService $invitations)
    {
        parent::__construct($auth);
    }

    public function listInvitations(Request $request)
    {
        return $this->respond('invitationList', function () use ($request) {
            $this->invitations->authorize($request->user($this->guard()), 'list');

            return $this->invitations->list();
        });
    }

    /**
     * Misma respuesta (202) exista o no una cuenta con ese correo, y sin el token. El envío ocurre DESPUÉS de
     * responder (`defer`), así que tampoco el tiempo de respuesta delata si la cuenta existía.
     */
    public function createInvitation({{ app.model }}CreateInvitationRequest $request)
    {
        return $this->respond('invitationCreate', function () use ($request) {
            $account = $request->user($this->guard());
            $this->invitations->authorize($account, 'create');
            $this->invitations->assertCanSend();
            $this->invitations->assertInviterWithinLimit((int) $account->getKey());

            $inviterId = (int) $account->getKey();
            $email = (string) $request->validated('email');
            defer(fn () => $this->invitations->invite($inviterId, $email));

            return [];
        }, 202);
    }

    public function revokeInvitation(Request $request, int $id)
    {
        return $this->respond('invitationRevoke', function () use ($request, $id) {
            $this->invitations->authorize($request->user($this->guard()), 'remove');
            $this->invitations->revoke($id);

            return [];
        });
    }

    /** Pública: crea la cuenta de la invitación. NO emite token (el alta no inicia sesión). */
    public function accept({{ app.model }}AcceptInvitationRequest $request)
    {
        return $this->respond('invitationAccept', function () use ($request) {
            $this->invitations->accept((string) $request->validated('token'), $request->validated());

            return ['accepted' => true];
        }, 201);
    }
}
