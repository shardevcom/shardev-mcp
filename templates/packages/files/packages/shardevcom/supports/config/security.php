<?php

/*
 * You can place your custom package configuration in here.
 */

use Spatie\Csp\Directive;
use Spatie\Csp\Keyword;

return [

    'servers' => [
        'vite' => [
            'host' => env('VITE_HOST', 'localhost'),
            'port' => env('VITE_PORT', 5173),
            'https' => env('VITE_HTTPS', false),
        ],
        'reverb' => [
            'host' => env('VITE_REVERB_HOST', 'localhost'),
            'port' => env('VITE_REVERB_PORT', 80),
            'https' => env('VITE_HTTPS', false),
        ],
        'reverb-server' => [
            'host' => env('VITE_REVERB_HOST', 'localhost'),
            'port' => env('REVERB_SERVER_PORT', '8080'),
            'https' => env('VITE_HTTPS', false),
        ],
    ],


    /*
    |--------------------------------------------------------------------------
    | content_security_policy
    |--------------------------------------------------------------------------
    |
    | List of unwanted headers that will be removed
    |
    */
    'content_security_policy_report_only' => false,

    /*
    |--------------------------------------------------------------------------
    | content_security_policy
    |--------------------------------------------------------------------------
    |
    | List of unwanted headers that will be removed
    |
    */
    'content_security_policy' => [
        Directive::BASE->value => Keyword::SELF,
        Directive::CONNECT->value => [
            Keyword::SELF,
            'https:',
            'wss://*.pusher.com',
            'https://www.googletagmanager.com',
            'https://www.google-analytics.com',
            'https://tagmanager.google.com'
        ],
        Directive::DEFAULT->value => [
            Keyword::SELF,
            'https:'
        ],
        Directive::MEDIA->value => [
            Keyword::SELF,
            'https:'
        ],
        Directive::IMG->value => [
            Keyword::SELF,
            'data:',
            'blob:',
            'https:',
            'https://gravatar.com',
            'https://via.placeholder.com',
            // Origen público de los archivos subidos (avatares, CDN). Ya cubierto por 'https:'; explícito para no depender
            // de él y para orígenes http locales (localstack). null si no es URL.
            (static function (?string $url): ?string {
                $parts = is_string($url) ? parse_url($url) : false;

                if (! is_array($parts) || ! in_array($parts['scheme'] ?? '', ['http', 'https'], true) || empty($parts['host'])) {
                    return null;
                }

                return $parts['scheme'].'://'.$parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
            })(env('CSP_PUBLIC_ASSETS_URL', env('AWS_CLOUDFRONT_URL'))),
        ],
        Directive::FONT->value => [
            Keyword::SELF,
            'https:',
            'https://*.gstatic.com'
        ],
        Directive::STYLE->value => [
            Keyword::SELF,
            'https:'
        ],
        Directive::STYLE_ELEM->value => [
            Keyword::SELF,
            Keyword::UNSAFE_INLINE,
            'https://*.googleapis.com',
            'https://www.googletagmanager.com',
            'https://fonts.bunny.net'
        ],
        Directive::STYLE_ATTR->value => [
            Keyword::SELF,
            Keyword::UNSAFE_INLINE
        ],
        Directive::SCRIPT->value => [
            Keyword::SELF,
            Keyword::UNSAFE_EVAL,
            'https:',
            'https://*.google.com',
            'https://www.googletagmanager.com',
            'https://tagmanager.google.com',
            'https://www.google-analytics.com'
        ],
        Directive::SCRIPT_ELEM->value => [
            Keyword::SELF,
            Keyword::UNSAFE_INLINE,
            'https://*.google.com',
            'https://*.gstatic.com',
            'https://cdn.jsdelivr.net',
            'https://www.googletagmanager.com',
            'https://tagmanager.google.com',
            'https://www.google-analytics.com',
        ],
        Directive::SCRIPT_ATTR->value => [
            Keyword::SELF,
            Keyword::UNSAFE_INLINE
        ]
    ],

    /*
    |--------------------------------------------------------------------------
    | security_header_unwanted_headers
    |--------------------------------------------------------------------------
    |
    | List of unwanted headers that will be removed
    |
    */
    'security_header_unwanted_headers' => [
        'X-Powered-By',
        'Server',
    ],

    /*
    |--------------------------------------------------------------------------
    | security_header_options_to_string
    |--------------------------------------------------------------------------
    |
    | Variable for conversion options to string split by delimiter (;)
    |
    */
    'security_header_options_to_string' => [
        'Strict-Transport-Security',
        'X-XSS-Protection',
        'Feature-Policy'
    ],

    /*
    |--------------------------------------------------------------------------
    | security_headers
    |--------------------------------------------------------------------------
    |
    | Secure header listing
    |
    */
    'security_headers' => [
        'Strict-Transport-Security' => [
            'max-age=31536000',
            'includeSubDomains',
        ],
        'X-Content-Type-Options' => 'nosniff',
        'X-Frame-Options' => 'DENY',
        'X-XSS-Protection' => [
            '1',
            'mode=block'
        ],
        'Referrer-Policy' => 'same-origin',
        'Permissions-Policy' => 'microphone=()',
        'Feature-Policy' => [
            "accelerometer 'none'",
            "ambient-light-sensor 'none'",
            "animations 'none'",
            "autoplay 'none'",
            "battery 'none'",
            "camera 'none'",
            "display-capture 'none'",
            "document-domain 'none'",
            "encrypted-media 'none'",
            "fullscreen 'none'",
            "geolocation 'none'",
            "gyroscope 'none'",
            "legacy-image-formats 'none'",
            "magnetometer 'none'",
            "microphone 'none'",
            "midi 'none'",
            "oversized-images 'none'",
            "payment 'none'",
            "picture-in-picture 'none'",
            "publickey-credentials 'none'",
            "sync-xhr 'none'",
            "unsized-media 'none'",
            "usb 'none'",
            "vibrate 'none'",
            "wake-lock 'none'",
            "xr-spatial-tracking 'none'",
        ],
    ],


];
