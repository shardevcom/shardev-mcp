<?php

namespace Shardevcom\Verification\Http\Controllers;

use Illuminate\Http\Request;
use Shardevcom\Supports\Controllers\Controller;
use Shardevcom\Verification\Http\Requests\RequestVerificationRequest;
use Shardevcom\Verification\Http\Requests\ResendVerificationRequest;
use Shardevcom\Verification\Http\Requests\VerifyVerificationRequest;
use Shardevcom\Verification\Repositories\VerificationChallengeRepository;
use Shardevcom\Verification\Services\VerificationManager;

class VerificationController extends Controller
{
    public function __construct(
        VerificationChallengeRepository $repository,
        protected VerificationManager $manager
    ) {
        $this->repository = $repository;
    }

    public function request(Request $request)
    {
        return $this->respond('request', function () use ($request) {
            $result = $this->manager->request(
                $this->resolveValidatedData($this->withOwnRecipient($request), RequestVerificationRequest::class)
            );

            return $this->challengePayload($result);
        }, 201);
    }

    public function resend(Request $request)
    {
        return $this->respond('resend', function () use ($request) {
            $result = $this->manager->resend(
                $this->resolveValidatedData($this->withOwnRecipient($request), ResendVerificationRequest::class)
            );

            return $this->challengePayload($result);
        }, 201);
    }

    public function verify(Request $request)
    {
        return $this->respond('verify', function () use ($request) {
            $challenge = $this->manager->verify(
                $this->resolveValidatedData($this->withOwnRecipient($request), VerifyVerificationRequest::class)
            );

            return [
                'reference' => $challenge->reference,
                'recipient' => $challenge->recipient,
                'purpose' => $challenge->purpose,
                'verified_at' => $challenge->verified_at,
            ];
        });
    }

    /**
     * El destinatario es siempre el correo del usuario autenticado: el
     * `recipient` que envíe el cliente se descarta.
     */
    private function withOwnRecipient(Request $request): Request
    {
        $request->merge(['recipient' => $request->user()?->email]);

        return $request;
    }

    /**
     * `code` solo viene informado si VERIFICATION_EXPOSE_CODE=true (por defecto null).
     */
    private function challengePayload(array $result): array
    {
        return [
            'reference' => $result['challenge']->reference,
            'channel' => $result['challenge']->channel,
            'recipient' => $result['challenge']->recipient,
            'purpose' => $result['challenge']->purpose,
            'expires_at' => $result['challenge']->expires_at,
            'code' => $result['code'],
        ];
    }
}
