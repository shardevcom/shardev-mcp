<?php

namespace App\Auth\Social;

use Shardevcom\Authentications\Http\Controllers\AccountAuthController;
use Shardevcom\Authentications\Services\AccountAuthService;

/** Login social de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). */
class {{ app.model }}SocialController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';

    public function __construct(AccountAuthService $auth, private {{ app.model }}SocialService $social)
    {
        parent::__construct($auth);
    }

    /** Proveedores que el SPA puede ofrecer (los habilitados Y configurados). Solo datos públicos. */
    public function providers()
    {
        return $this->respond('socialProviders', fn () => $this->social->publicProviders());
    }

    public function login(string $provider, {{ app.model }}SocialRequest $request)
    {
        return $this->respond('socialLogin', fn () => $this->social->login($provider, (string) $request->validated('id_token')));
    }

    public function link(string $provider, {{ app.model }}SocialRequest $request)
    {
        return $this->respond('socialLink', fn () => $this->social->link($request->user($this->guard()), $provider, (string) $request->validated('id_token')));
    }
}
