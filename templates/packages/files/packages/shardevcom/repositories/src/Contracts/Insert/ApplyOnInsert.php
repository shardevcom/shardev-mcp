<?php

namespace Shardevcom\Repositories\Contracts\Insert;

interface ApplyOnInsert
{
    public function applyOnInsert(array $data): array;
}
