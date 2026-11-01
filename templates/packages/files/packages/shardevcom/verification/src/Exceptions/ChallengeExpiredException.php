<?php

namespace Shardevcom\Verification\Exceptions;

class ChallengeExpiredException extends VerificationException
{
    public function __construct(string $message = 'messages.verification.challenge_expired', int $code = 410)
    {
        parent::__construct($message, $code);
    }
}
