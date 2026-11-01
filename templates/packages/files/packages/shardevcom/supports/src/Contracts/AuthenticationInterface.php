<?php

namespace Shardevcom\Supports\Contracts;

use Illuminate\Contracts\Auth\Authenticatable;

interface AuthenticationInterface
{
    public function id(): int|string|null;
    public function type(): ?string;
    public function guard(): ?string;
    public function user(): ?Authenticatable;
    public function toArray(): array;
}
