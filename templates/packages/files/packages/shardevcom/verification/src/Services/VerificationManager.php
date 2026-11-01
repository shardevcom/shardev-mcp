<?php

namespace Shardevcom\Verification\Services;

use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Throwable;
use Shardevcom\Verification\Exceptions\AttemptsExceededException;
use Shardevcom\Verification\Exceptions\ChallengeExpiredException;
use Shardevcom\Verification\Exceptions\ChallengeNotFoundException;
use Shardevcom\Verification\Exceptions\InvalidCodeException;
use Shardevcom\Verification\Exceptions\ResendCooldownActiveException;
use Shardevcom\Verification\Contracts\VerificationChannelInterface;
use Shardevcom\Verification\Events\VerificationFailed;
use Shardevcom\Verification\Events\VerificationRequested;
use Shardevcom\Verification\Events\VerificationSent;
use Shardevcom\Verification\Events\VerificationVerified;
use Shardevcom\Verification\Models\VerificationChallenge;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;

class VerificationManager
{
    public function __construct(
        protected VerificationChallengeRepository $repository,
        protected VerificationChannelInterface $channel
    ) {
    }

    public function request(array $payload): array
    {
        $channel = $payload['channel'] ?? config('verification.default_channel', 'email');
        $recipient = trim((string) $payload['recipient']);
        $purpose = trim((string) $payload['purpose']);
        $context = $payload['context'] ?? [];
        $meta = $payload['meta'] ?? [];

        $this->guardCooldown($channel, $recipient, $purpose);
        $this->repository->invalidateActive($channel, $recipient, $purpose);

        $code = $this->generateCode();
        $challenge = $this->repository->insert([
            'channel' => $channel,
            'purpose' => $purpose,
            'recipient' => $recipient,
            'code_hash' => Hash::make($code),
            'code_last' => null,
            'attempts' => 0,
            'max_attempts' => (int) config('verification.attempts.max', 5),
            'context' => $context,
            'meta' => $meta,
            'expires_at' => now()->addMinutes((int) config('verification.ttl', 10)),
        ]);

        event(new VerificationRequested($challenge));

        try {
            $this->channel->send($challenge, $code);
            $challenge = $this->repository->markSent($challenge);
            event(new VerificationSent($challenge));
        } catch (Throwable $exception) {
            $challenge = $this->repository->invalidate($challenge, 'delivery_failed');
            event(new VerificationFailed($challenge, 'delivery_failed', [
                'exception' => $exception->getMessage(),
            ]));

            throw $exception;
        }

        return [
            'challenge' => $challenge,
            'code' => config('verification.response.expose_code', false) ? $code : null,
        ];
    }

    public function resend(array $payload): array
    {
        return $this->request($payload);
    }

    /**
     * Validate a code against the active challenge WITHOUT consuming it
     * (no markVerified, no attempt increment on success).
     *
     * Used by verifyCode() for new users: proves the OTP is correct before
     * throwing UserNotFoundException, so register() can reuse the same
     * active challenge. Throws the same RuntimeException variants as verify().
     */
    public function checkCode(array $payload): void
    {
        $channel   = $payload['channel']   ?? config('verification.default_channel', 'email');
        $recipient = trim((string) $payload['recipient']);
        $purpose   = trim((string) $payload['purpose']);
        $code      = trim((string) $payload['code']);

        $challenge = $this->repository->latestActiveFor($channel, $recipient, $purpose);

        if (! $challenge) {
            throw new ChallengeNotFoundException();
        }

        if ($challenge->isExpired()) {
            $this->repository->invalidate($challenge, 'expired');
            throw new ChallengeExpiredException();
        }

        if ($challenge->attempts >= $challenge->max_attempts) {
            $this->repository->invalidate($challenge, 'attempts_exceeded');
            throw new AttemptsExceededException();
        }

        // Increment attempts so brute-force protection still applies.
        $challenge = $this->repository->incrementAttempts($challenge);

        if (! Hash::check($code, $challenge->code_hash)) {
            if ($challenge->attempts >= $challenge->max_attempts) {
                $this->repository->invalidate($challenge, 'attempts_exceeded');
            }
            throw new InvalidCodeException();
        }
        // Code is valid — do NOT call markVerified() so register() can use it.
    }

    public function verify(array $payload): VerificationChallenge
    {
        $channel = $payload['channel'] ?? config('verification.default_channel', 'email');
        $recipient = trim((string) $payload['recipient']);
        $purpose = trim((string) $payload['purpose']);
        $code = trim((string) $payload['code']);
        $reference = $payload['reference'] ?? null;

        $challenge = $reference
            ? $this->repository->findActiveByReference($reference, $channel, $recipient, $purpose)
            : $this->repository->latestActiveFor($channel, $recipient, $purpose);

        if (!$challenge) {
            event(new VerificationFailed(null, 'not_found', [
                'channel' => $channel,
                'recipient' => $recipient,
                'purpose' => $purpose,
            ]));

            throw new ChallengeNotFoundException();
        }

        if ($challenge->isExpired()) {
            $challenge = $this->repository->invalidate($challenge, 'expired');
            event(new VerificationFailed($challenge, 'expired'));
            throw new ChallengeExpiredException();
        }

        if ($challenge->attempts >= $challenge->max_attempts) {
            $challenge = $this->repository->invalidate($challenge, 'attempts_exceeded');
            event(new VerificationFailed($challenge, 'attempts_exceeded'));
            throw new AttemptsExceededException();
        }

        $challenge = $this->repository->incrementAttempts($challenge);

        if (!Hash::check($code, $challenge->code_hash)) {
            if ($challenge->attempts >= $challenge->max_attempts) {
                $challenge = $this->repository->invalidate($challenge, 'attempts_exceeded');
            }

            event(new VerificationFailed($challenge, 'invalid_code'));
            throw new InvalidCodeException();
        }

        $challenge = $this->repository->markVerified($challenge);

        event(new VerificationVerified($challenge));

        return $challenge;
    }

    protected function guardCooldown(string $channel, string $recipient, string $purpose): void
    {
        $active = $this->repository->latestActiveFor($channel, $recipient, $purpose);

        if (!$active || !$active->sent_at) {
            return;
        }

        $cooldown = (int) config('verification.resend_cooldown', 60);
        if ($cooldown <= 0) {
            return;
        }

        if ($active->sent_at->diffInSeconds(now()) < $cooldown) {
            throw new ResendCooldownActiveException();
        }
    }

    protected function generateCode(): string
    {
        $length = max(4, (int) config('verification.otp.code.length', 6));
        $characters = (string) config('verification.otp.code.characters', '0123456789');
        $maxIndex = strlen($characters) - 1;

        if ($maxIndex < 0) {
            throw new RuntimeException('Verification code characters configuration is empty.');
        }

        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= $characters[random_int(0, $maxIndex)];
        }

        return $code;
    }
}
