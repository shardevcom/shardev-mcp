<?php

namespace Shardevcom\Repositories\Facades;

use Illuminate\Support\Facades\Facade;

class Repository extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return 'repositories';
    }
}
