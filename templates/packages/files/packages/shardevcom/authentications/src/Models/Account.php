<?php

namespace Shardevcom\Authentications\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Passport\HasApiTokens;
use Shardevcom\Authentications\Events\AccountCreated;
use Shardevcom\Supports\Traits\HasAvatar;
use Spatie\Permission\Traits\HasRoles;

/**
 * Base de las cuentas de cada app (usuarios, administradores...). El proyecto genera una subclase
 * por app con su `$table` y su `$guard_name` (el guard Bearer, que es el que usa Spatie para roles).
 */
abstract class Account extends Authenticatable
{
    use HasApiTokens, HasAvatar, HasFactory, HasRoles, Notifiable;

    protected $fillable = [
        'name',
        'email',
        'phone',
        'avatar_url',
        'password',
        'active',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected $appends = ['avatar_public_url'];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    protected static function booted(): void
    {
        static::created(fn (self $account) => event(new AccountCreated($account)));
    }
}
