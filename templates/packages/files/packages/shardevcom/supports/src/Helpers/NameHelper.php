<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Support\Str;

class NameHelper
{

    public static function normalize(?string $text): ?string
    {
        return $text
            ? Str::of($text)->ascii()->lower()->squish()->value()
            : null;
    }

    public static function format(string $name): string
    {
        return ucwords(mb_strtolower(trim($name)));
    }

}
