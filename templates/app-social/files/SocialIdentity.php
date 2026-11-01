<?php

namespace App\Auth\Social;

use Illuminate\Database\Eloquent\Model;

/**
 * Identidad de un proveedor (google, microsoft, apple) vinculada a UNA cuenta de la app `{{ app.key }}`.
 * La tabla es de esta app: la misma identidad en otra app es otra fila en otra tabla, así que no cruza guards.
 * `account_id` NO es asignable en masa: lo fija el servicio con la cuenta ya resuelta.
 */
class {{ app.model }}SocialIdentity extends Model
{
    protected $table = '{{ app.table }}_social_identities';

    protected $fillable = ['provider', 'subject', 'email', 'email_verified'];

    protected function casts(): array
    {
        return ['email_verified' => 'boolean'];
    }
}
