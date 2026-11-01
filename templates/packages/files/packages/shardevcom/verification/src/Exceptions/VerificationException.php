<?php

namespace Shardevcom\Verification\Exceptions;

use Shardevcom\Supports\Exceptions\UserFacingException;

/**
 * Base class for verification errors whose message is safe to return to the
 * client: every subclass carries a message written for the end user, not a
 * technical diagnostic.
 *
 * This type is the signal controllers use to decide what to publish. Anything
 * that is NOT a VerificationException (a TypeError, a QueryException, a broken
 * configuration) must be answered with a generic message, since its
 * getMessage() contains internals — SQL, file paths, provider hosts.
 */
abstract class VerificationException extends UserFacingException
{
    /**
     * The verification API has always answered every verification error with
     * 422, whatever code the subclass carries (404, 410); the SPAs rely on it.
     * ResendCooldownActiveException is the exception: it answers 429.
     */
    public function getStatusCode(): int
    {
        return 422;
    }
}
