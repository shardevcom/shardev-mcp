<?php

namespace Shardevcom\Verification\Commands;

use Illuminate\Console\Command;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;

class PruneVerificationChallengesCommand extends Command
{
    protected $signature = 'verification:prune {--hours=24 : Delete challenges older than the given amount of hours}';

    protected $description = 'Prune expired, verified or invalidated verification challenges';

    public function handle(VerificationChallengeRepository $repository): int
    {
        $deleted = $repository->prune((int) $this->option('hours'));

        $this->info("Verification challenges deleted: {$deleted}");

        return self::SUCCESS;
    }
}
