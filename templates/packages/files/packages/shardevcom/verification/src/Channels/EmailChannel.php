<?php

namespace Shardevcom\Verification\Channels;

use App\Mail\VerificationCodeMail;
use Illuminate\Support\Facades\Mail;
use Shardevcom\Verification\Contracts\VerificationChannelInterface;
use Shardevcom\Verification\Models\VerificationChallenge;

class EmailChannel implements VerificationChannelInterface
{
    public function channel(): string
    {
        return 'email';
    }

    public function send(VerificationChallenge $challenge, string $code): void
    {
        $mailer = Mail::to($challenge->recipient);

        $mailable = new VerificationCodeMail($code);

        if (config('verification.email.queue', false)) {
            $mailer->queue($mailable);
            return;
        }

        $mailer->send($mailable);
    }
}
