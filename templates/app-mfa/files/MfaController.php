<?php

namespace App\Auth\Mfa;

use Illuminate\Http\Request;
use Shardevcom\Authentications\Http\Controllers\AccountAuthController;
use Shardevcom\Authentications\Http\Requests\LoginRequest;
use Shardevcom\Authentications\Services\AccountAuthService;

/**
 * Segundo factor (TOTP) de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). La cuenta sale siempre del
 * token (`$request->user($guard)`), nunca del cuerpo. `signin` está sobrescrito a propósito: el de la clase
 * base emite el token sin pasar por el segundo factor.
 */
class {{ app.model }}MfaController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';

    public function __construct(AccountAuthService $auth, private {{ app.model }}MfaService $mfa)
    {
        parent::__construct($auth);
    }

    public function signin(LoginRequest $request)
    {
        return $this->respond('signin', fn () => $this->mfa->signin($request->validated()));
    }

    public function verify({{ app.model }}MfaVerifyRequest $request)
    {
        return $this->respond('mfaVerify', fn () => $this->mfa->verify((string) $request->validated('challenge'), (string) $request->validated('code')));
    }

    public function status(Request $request)
    {
        return $this->respond('mfaStatus', fn () => $this->mfa->status($request->user($this->guard())));
    }

    public function setup(Request $request)
    {
        return $this->respond('mfaSetup', fn () => $this->mfa->setup($request->user($this->guard())));
    }

    public function confirm({{ app.model }}MfaCodeRequest $request)
    {
        return $this->respond('mfaConfirm', fn () => $this->mfa->confirm($request->user($this->guard()), (string) $request->validated('code')));
    }

    public function disable({{ app.model }}MfaPasswordCodeRequest $request)
    {
        return $this->respond('mfaDisable', fn () => $this->mfa->disable($request->user($this->guard()), (string) $request->validated('password'), (string) $request->validated('code')));
    }

    public function recoveryCodes({{ app.model }}MfaPasswordCodeRequest $request)
    {
        return $this->respond('mfaRecoveryCodes', fn () => $this->mfa->regenerateRecoveryCodes($request->user($this->guard()), (string) $request->validated('password'), (string) $request->validated('code')));
    }
}
