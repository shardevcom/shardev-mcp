<?php

use Shardevcom\Supports\Policies\ContentSecurityPolicy;
use Spatie\Csp\Nonce\RandomString;

// CSP_REPORT_ONLY=true publica la política como "report-only" (no bloquea) para probar cambios.
$policy = [ContentSecurityPolicy::class];
$reportOnly = (bool) env('CSP_REPORT_ONLY', false);

return [
    'presets' => $reportOnly ? [] : $policy,
    'directives' => [],

    'report_only_presets' => $reportOnly ? $policy : [],
    'report_only_directives' => [],

    'report_uri' => env('CSP_REPORT_URI', ''),
    'report_only_uri' => env('CSP_REPORT_ONLY_URI', ''),
    'report_to' => env('CSP_REPORT_TO', ''),
    'report_only_to' => env('CSP_REPORT_ONLY_TO', ''),
    'reporting_endpoints' => [],

    // La política se emite siempre salvo CSP_ENABLED=false (no lo desactives sin una razón revisada).
    'enabled' => env('CSP_ENABLED', true),
    'enabled_while_hot_reloading' => env('CSP_ENABLED_WHILE_HOT_RELOADING', false),

    'nonce_generator' => RandomString::class,
    'nonce_enabled' => env('CSP_NONCE_ENABLED', true),
];
