<?php

namespace App\Auth\Invitations;

use Illuminate\Database\Eloquent\Model;

/**
 * Invitación a la app `{{ app.key }}`. Tabla propia de la app. `inviter_id` y `token_hash` NO son asignables en
 * masa: los fija el servicio (el invitador sale de la cuenta autenticada, nunca de la entrada).
 */
class {{ app.model }}Invitation extends Model
{
    protected $table = '{{ app.table }}_invitations';

    protected $fillable = ['email', 'expires_at'];

    protected $hidden = ['token_hash'];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
