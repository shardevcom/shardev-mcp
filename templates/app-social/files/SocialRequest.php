<?php

namespace App\Auth\Social;

use Shardevcom\Supports\Requests\JsonRequest;

/**
 * Login/vínculo social de la app `{{ app.key }}`. Solo se lee el id_token: nada de correo, id de usuario ni
 * proveedor en el cuerpo (el proveedor viene de la ruta, la identidad de los claims verificados).
 */
class {{ app.model }}SocialRequest extends JsonRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'id_token' => ['required', 'string', 'max:8192'],
        ];
    }
}
