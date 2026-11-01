<?php

namespace App\Auth\Mfa;

use Illuminate\Database\Eloquent\Model;

/**
 * Desafío de segundo factor de la app `{{ app.key }}`: lo que recibe el cliente tras una contraseña correcta
 * en lugar de un token. Solo se guarda el sha256 del valor opaco; ni `account_id` ni el hash son asignables.
 */
class {{ app.model }}MfaChallenge extends Model
{
    protected $table = '{{ app.table }}_mfa_challenges';

    protected $fillable = ['expires_at'];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return [
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
        ];
    }
}
