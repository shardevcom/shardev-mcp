<?php

namespace App\Auth\Invitations;

use Shardevcom\Supports\Requests\JsonRequest;

/** Invita a un correo a la app `{{ app.key }}`. Solo se lee el correo: quien invita sale del token. */
class {{ app.model }}CreateInvitationRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'email' => ['required', 'email', 'max:255'],
        ];
    }
}
