<?php

namespace Shardevcom\Repositories\Contracts\Upsert;

interface ApplyOnUpsert
{
    public function applyOnUpsert(
        array $rows,
        array $uniqueBy,
        ?array $update = null
    ): array;
}
