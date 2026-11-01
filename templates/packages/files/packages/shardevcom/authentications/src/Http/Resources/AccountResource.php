<?php

namespace Shardevcom\Authentications\Http\Resources;

use Illuminate\Http\Resources\Json\JsonResource;
use Shardevcom\Authentications\Models\Account;

/**
 * Perfil de la cuenta autenticada. Con `withToken()` añade el token de acceso: úsalo solo en la
 * respuesta de login / cambio de contraseña, nunca en listados.
 */
class AccountResource extends JsonResource
{
    public function toArray($request): array
    {
        /** @var Account $account */
        $account = $this->resource;

        return [
            'id' => $account->getKey(),
            'name' => $account->name,
            'email' => $account->email,
            'phone' => $account->phone,
            'avatar_url' => $account->avatar_url,
            'avatar_public_url' => $account->avatar_public_url,
            'roles' => $account->roles,
            'permissions' => $account->getAllPermissions(),
        ];
    }

    public static function withToken(Account $account, string $tokenName): array
    {
        $token = $account->createToken($tokenName);

        return array_merge((new self($account))->toArray(request()), [
            'access_token' => $token->accessToken,
            'token_type' => 'Bearer',
            'expires_at' => $token->token->expires_at,
        ]);
    }
}
