<?php

namespace Shardevcom\Repositories\Contracts;


use Illuminate\Database\Eloquent\Model;

interface RepositoryInterface
{
    public function getModel(): Model;
    public function newQuery(): \Illuminate\Database\Eloquent\Builder;
    public function getResource(): string;
}
