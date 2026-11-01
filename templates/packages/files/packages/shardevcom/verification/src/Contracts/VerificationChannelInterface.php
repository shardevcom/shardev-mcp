<?php

namespace Shardevcom\Verification\Contracts;

use Shardevcom\Verification\Models\VerificationChallenge;

interface VerificationChannelInterface
{
    public function channel(): string;

    public function send(VerificationChallenge $challenge, string $code): void;
}
