<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

trait HasDatabaseConnection
{
    protected function hasDatabaseConnection(): bool
    {
        try {
            DB::connection()->getPdo();
            return true;
        } catch (\Throwable $e) {
            Log::warning('Database unavailable', [
                'error' => $e->getMessage()
            ]);

            return false;
        }
    }
}
