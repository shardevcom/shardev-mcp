<?php

namespace Shardevcom\Supports\Auth;

use Illuminate\Contracts\Auth\Authenticatable;
use Shardevcom\Supports\Contracts\AuthenticationInterface;

class Authentication implements AuthenticationInterface
{
    public function __construct(
        protected int|string|null $id,
        protected ?string $type,
        protected ?string $guard,
        protected ?Authenticatable $user,
    ) {}

    public function id(): int|string|null
    {
        return $this->id;
    }

    public function type(): ?string
    {
        return $this->type;
    }

    public function guard(): ?string
    {
        return $this->guard;
    }

    public function user(): ?Authenticatable
    {
        return $this->user;
    }

    public function toArray(): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'guard' => $this->guard,
            'user' => $this->user,
        ];
    }
}
