<?php

namespace Shardevcom\Verification\Events;

use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;
use Shardevcom\Verification\Models\VerificationChallenge;

class VerificationFailed
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public ?VerificationChallenge $challenge,
        public string $reason,
        public array $context = []
    ) {
    }
}
