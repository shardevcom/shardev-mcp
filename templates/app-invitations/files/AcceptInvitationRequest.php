<?php

namespace App\Auth\Invitations;

{{#if !app.feature.otp}}
use Illuminate\Validation\Rules\Password;
{{/if}}
use Shardevcom\Supports\Requests\JsonRequest;

/**
 * Acepta una invitación de la app `{{ app.key }}`. El correo NO viene del cliente: es el de la invitación.
{{#if app.feature.otp}}
 * Esta app entra por código (otp): no hay contraseña que elegir.
{{/if}}
 */
class {{ app.model }}AcceptInvitationRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'token' => ['required', 'string', 'min:32', 'max:128'],
            'name' => ['required', 'string', 'max:255'],
{{#if !app.feature.otp}}
            'password' => ['required', 'string', 'max:255', Password::min(10)],
{{/if}}
        ];
    }
}
