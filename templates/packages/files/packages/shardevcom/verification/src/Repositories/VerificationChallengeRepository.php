<?php

namespace Shardevcom\Verification\Repositories;

use Illuminate\Database\Eloquent\Collection;
use Shardevcom\Repositories\Repository;
use Shardevcom\Verification\Models\VerificationChallenge;

class VerificationChallengeRepository extends Repository
{
    protected string $resource = 'verifications';

    protected array $searchableFields = [
        'reference',
        'channel',
        'purpose',
        'recipient',
        'invalid_reason',
    ];

    protected array $filterableFields = [
        'id',
        'reference',
        'channel',
        'purpose',
        'recipient',
        'verified_at',
        'invalidated_at',
        'expires_at',
        'created_at',
    ];

    protected array $sortableFields = [
        'id',
        'recipient',
        'purpose',
        'expires_at',
        'created_at',
        'updated_at',
    ];

    protected array $allowedFields = [
        'id',
        'reference',
        'channel',
        'purpose',
        'recipient',
        'code_last',
        'attempts',
        'max_attempts',
        'context',
        'meta',
        'sent_at',
        'expires_at',
        'verified_at',
        'invalidated_at',
        'invalid_reason',
        'created_at',
        'updated_at',
    ];

    public function __construct(VerificationChallenge $model)
    {
        parent::__construct($model);
    }

    public function latestActiveFor(string $channel, string $recipient, string $purpose): ?VerificationChallenge
    {
        return $this->model->newQuery()
            ->where('channel', $channel)
            ->where('recipient', $recipient)
            ->where('purpose', $purpose)
            ->whereNull('verified_at')
            ->whereNull('invalidated_at')
            ->where('expires_at', '>', now())
            ->latest('id')
            ->first();
    }

    public function findActiveByReference(string $reference, string $channel, string $recipient, string $purpose): ?VerificationChallenge
    {
        return $this->model->newQuery()
            ->where('reference', $reference)
            ->where('channel', $channel)
            ->where('recipient', $recipient)
            ->where('purpose', $purpose)
            ->whereNull('verified_at')
            ->whereNull('invalidated_at')
            ->first();
    }

    public function findVerifiedByReference(string $reference, string $channel, string $recipient, string $purpose, bool $forUpdate = false): ?VerificationChallenge
    {
        $query = $this->model->newQuery()
            ->where('reference', $reference)
            ->where('channel', $channel)
            ->where('recipient', $recipient)
            ->where('purpose', $purpose)
            ->whereNotNull('verified_at')
            ->whereNull('invalidated_at');

        if ($forUpdate) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    public function invalidateActive(string $channel, string $recipient, string $purpose, string $reason = 'replaced'): int
    {
        return $this->model->newQuery()
            ->where('channel', $channel)
            ->where('recipient', $recipient)
            ->where('purpose', $purpose)
            ->whereNull('verified_at')
            ->whereNull('invalidated_at')
            ->update([
                'invalidated_at' => now(),
                'invalid_reason' => $reason,
                'updated_at' => now(),
            ]);
    }

    public function markSent(VerificationChallenge $challenge): VerificationChallenge
    {
        $challenge->update(['sent_at' => now()]);

        return $challenge->fresh();
    }

    public function markVerified(VerificationChallenge $challenge): VerificationChallenge
    {
        $challenge->update([
            'verified_at' => now(),
            'invalid_reason' => null,
        ]);

        return $challenge->fresh();
    }

    public function incrementAttempts(VerificationChallenge $challenge): VerificationChallenge
    {
        $challenge->increment('attempts');

        return $challenge->fresh();
    }

    public function invalidate(VerificationChallenge $challenge, string $reason): VerificationChallenge
    {
        $challenge->update([
            'invalidated_at' => now(),
            'invalid_reason' => $reason,
        ]);

        return $challenge->fresh();
    }

    public function prune(int $hours = 24): int
    {
        return $this->model->newQuery()
            ->where(function ($query) use ($hours) {
                $query->where('expires_at', '<', now()->subHours($hours))
                    ->orWhere('verified_at', '<', now()->subHours($hours))
                    ->orWhere('invalidated_at', '<', now()->subHours($hours));
            })
            ->delete();
    }

    public function recentFor(string $channel, string $recipient, string $purpose): Collection
    {
        return $this->model->newQuery()
            ->where('channel', $channel)
            ->where('recipient', $recipient)
            ->where('purpose', $purpose)
            ->latest('id')
            ->get();
    }
}
