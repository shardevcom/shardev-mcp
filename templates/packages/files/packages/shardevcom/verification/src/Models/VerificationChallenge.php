<?php

namespace Shardevcom\Verification\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

class VerificationChallenge extends Model
{
    protected $fillable = [
        'reference',
        'channel',
        'purpose',
        'recipient',
        'code_hash',
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
    ];

    protected $casts = [
        'context' => 'array',
        'meta' => 'array',
        'sent_at' => 'datetime',
        'expires_at' => 'datetime',
        'verified_at' => 'datetime',
        'invalidated_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $challenge) {
            if (empty($challenge->reference)) {
                $challenge->reference = (string) Str::uuid();
            }
        });
    }

    public function isExpired(): bool
    {
        return $this->expires_at instanceof Carbon
            ? $this->expires_at->isPast()
            : false;
    }

    public function isPending(): bool
    {
        return !$this->verified_at && !$this->invalidated_at && !$this->isExpired();
    }
}
