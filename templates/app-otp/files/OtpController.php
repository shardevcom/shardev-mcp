<?php

namespace App\Auth\Otp;

use Shardevcom\Authentications\Http\Controllers\AccountAuthController;
use Shardevcom\Authentications\Services\AccountAuthService;

/** Login por código de la app `{{ app.key }}` (guard `{{ app.api_guard }}`). */
class {{ app.model }}OtpController extends AccountAuthController
{
    protected string $app = '{{ app.key }}';

    public function __construct(AccountAuthService $auth, private {{ app.model }}OtpService $otp)
    {
        parent::__construct($auth);
    }

    /**
     * Misma respuesta (202) exista o no la cuenta, esté o no en enfriamiento, y sin el código. El envío
     * ocurre DESPUÉS de responder (`defer`), así que tampoco el tiempo de respuesta delata si había cuenta.
     */
    public function requestCode({{ app.model }}OtpCodeRequest $request)
    {
        return $this->respond('otpRequest', function () use ($request) {
            $email = (string) $request->validated('email');
            defer(fn () => $this->otp->requestCode($email));

            return [];
        }, 202);
    }

    public function verifyCode({{ app.model }}OtpVerifyRequest $request)
    {
        return $this->respond('otpVerify', fn () => $this->otp->verifyCode((string) $request->validated('email'), (string) $request->validated('code')));
    }
}
