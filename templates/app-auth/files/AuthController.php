<?php

namespace App\Http\Controllers;

{{#if app.feature.mfa}}
use {{ app.mfa_service_class }};
use Shardevcom\Authentications\Http\Requests\LoginRequest;
{{/if}}
use Shardevcom\Authentications\Http\Controllers\AccountAuthController;

/** Login, logout y perfil de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). */
class {{ app.model }}AuthController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';
{{#if app.feature.mfa}}

    /**
     * Esta app tiene MFA (feature mfa): el `signin` de la clase base emite el token sin segundo factor, así
     * que se sobrescribe. Una cuenta con MFA recibe un desafío; sin MFA, la respuesta normal.
     */
    public function signin(LoginRequest $request)
    {
        return $this->respond('signin', fn () => app({{ app.model }}MfaService::class)->signin($request->validated()));
    }
{{/if}}
}
