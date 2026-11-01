<?php

namespace Shardevcom\Verification\Exceptions;

class ChallengeNotFoundException extends VerificationException
{
    public function __construct(string $message = 'messages.verification.challenge_not_found', int $code = 404)
    {
        parent::__construct($message, $code);
    }
}
