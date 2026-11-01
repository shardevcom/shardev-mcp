<?php

namespace Shardevcom\Supports\Policies;

use Shardevcom\Supports\Services\Security\SecurityConfigService;
use Spatie\Csp\Directive;
use Spatie\Csp\Keyword;
use Spatie\Csp\Policy;
use Spatie\Csp\Preset;
use Spatie\Csp\Presets\Basic;

/**
 * Preset de CSP del proyecto (spatie/laravel-csp 3.x). Parte de `Basic` y le suma las directivas de
 * config/security.php (`content_security_policy`, claves = nombre de la directiva) más los servidores
 * de Vite/WebSocket activos. Se registra en config/csp.php (`presets`).
 */
class ContentSecurityPolicy implements Preset
{
    public function __construct(protected SecurityConfigService $securityConfig) {}

    public function configure(Policy $policy): void
    {
        (new Basic())->configure($policy);

        foreach ($this->securityConfig->getCspWithServers() as $name => $values) {
            $directive = Directive::tryFrom((string) $name);
            $filtered = array_values(array_filter(is_array($values) ? $values : [$values], fn ($value) => ! is_null($value)));

            if ($directive !== null && $filtered !== []) {
                $policy->add($directive, $filtered);
            }
        }

        // Los scripts de desarrollo local de Vite usan eval.
        if (app()->environment('local')) {
            $policy->add(Directive::SCRIPT_ELEM, Keyword::UNSAFE_EVAL);
        }
    }
}
