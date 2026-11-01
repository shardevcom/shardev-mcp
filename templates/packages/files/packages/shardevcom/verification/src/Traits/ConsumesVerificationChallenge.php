<?php

namespace Shardevcom\Verification\Traits;

use Illuminate\Support\Facades\DB;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;

/**
 * Shared step-up-authentication helper: given a client-submitted
 * verification_reference, confirms it is a verified, unconsumed challenge
 * for the given purpose and recipient, then atomically invalidates it so it
 * cannot be replayed. Mirrors CreatePayoutAction::consumeVerification()
 * — extracted here as a trait rather than duplicated a third
 * time, since a second unrelated call site (this one) now needs the exact
 * same logic.
 */
trait ConsumesVerificationChallenge
{
    protected function consumeVerificationChallenge(?string $reference, string $recipient, string $purpose, string $channel = 'email'): void
    {
        if (empty($reference)) {
            abort(422, __('messages.verification.required'));
        }

        DB::transaction(function () use ($reference, $recipient, $purpose, $channel) {
            $repository = app(VerificationChallengeRepository::class);

            $challenge = $repository->findVerifiedByReference($reference, $channel, $recipient, $purpose, true);

            if (! $challenge) {
                abort(422, __('messages.verification.invalid'));
            }

            $repository->invalidate($challenge, "consumed_by_{$purpose}");
        });
    }
}
