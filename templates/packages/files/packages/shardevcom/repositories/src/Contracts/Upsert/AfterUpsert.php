<?php

namespace Shardevcom\Repositories\Contracts\Upsert;

interface AfterUpsert
{
    public function afterUpsert(
        int $count,
        array $rows,
        array $uniqueBy,
        ?array $update = null
    ): void;
}
