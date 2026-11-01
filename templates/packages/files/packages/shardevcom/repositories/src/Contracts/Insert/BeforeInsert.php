<?php

namespace Shardevcom\Repositories\Contracts\Insert;

interface BeforeInsert
{
    public function beforeInsert(array $data): array;
}
