<?php

return [
    'default_method' => env('VERIFICATION_DEFAULT_METHOD', 'otp'),
    'default_channel' => env('VERIFICATION_DEFAULT_CHANNEL', 'email'),
    'ttl' => (int) env('VERIFICATION_TTL', 10),
    'resend_cooldown' => (int) env('VERIFICATION_RESEND_COOLDOWN', 60),
    'attempts' => [
        'max' => (int) env('VERIFICATION_MAX_ATTEMPTS', 5),
    ],
    'otp' => [
        'code' => [
            'length' => (int) env('VERIFICATION_OTP_CODE_LENGTH', 6),
            'characters' => env('VERIFICATION_OTP_CODE_CHARACTERS', '0123456789'),
        ],
    ],
    'response' => [
        'expose_code' => (bool) env('VERIFICATION_EXPOSE_CODE', false),
    ],

    'route' => [
        'prefix' => 'verification',
        // solo el usuario autenticado pide y verifica códigos, y el
        // throttle va después de auth para contarse por usuario y no por IP.
        'middleware' => ['auth:'.env('VERIFICATION_GUARD', 'web'), 'throttle:6,1'],
    ],

    'email' => [
        'from' => [
            'address' => env('VERIFICATION_MAIL_FROM_ADDRESS', env('MAIL_FROM_ADDRESS')),
            'name' => env('VERIFICATION_MAIL_FROM_NAME', env('MAIL_FROM_NAME', env('APP_NAME', 'Laravel'))),
        ],
        'subject' => env('VERIFICATION_MAIL_SUBJECT', 'Your verification code'),
        'view' => env('VERIFICATION_MAIL_VIEW', 'verification::emails.code'),
        'queue' => (bool) env('VERIFICATION_MAIL_QUEUE', false),
    ],
];
