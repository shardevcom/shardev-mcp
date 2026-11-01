<?php

namespace Shardevcom\Supports\Helpers;

class PhoneHelper
{
    public static function format(?string $phone): ?string
    {
        if (empty($phone)) {
            return null;
        }

        $phone = trim($phone);
        $phone = preg_replace('/[^\d+]/', '', $phone);

        if (empty($phone)) {
            return null;
        }

        if (strpos($phone, '+') === 0) {
            return $phone;
        }

        if (strlen($phone) > 10) {
            $countryCode = substr($phone, 0, 1);
            $restOfNumber = substr($phone, 1);
        } else {
            $countryCode = '1';
            $restOfNumber = $phone;
        }

        return "+$countryCode$restOfNumber";
    }
}
