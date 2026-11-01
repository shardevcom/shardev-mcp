<?php

namespace Shardevcom\Repositories\Contracts\Upsert;

interface BeforeUpsert
{
    public function beforeUpsert(
        array $rows,
        array $uniqueBy,
        ?array $update = null
    ): array;
}
