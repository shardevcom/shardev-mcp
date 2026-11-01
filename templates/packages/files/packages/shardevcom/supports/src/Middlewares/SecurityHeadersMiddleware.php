<?php

namespace Shardevcom\Supports\Middlewares;

use Closure;
use Illuminate\Http\Request;
use Shardevcom\Supports\Contracts\HeaderCleanerInterface;
use Shardevcom\Supports\Contracts\HeaderSetterInterface;

class SecurityHeadersMiddleware
{
    public function __construct(
        protected HeaderSetterInterface $setter,
        protected HeaderCleanerInterface $cleaner
    ) {}

    public function handle(Request $request, Closure $next)
    {
        $this->cleaner->clean();
        $response = $next($request);
        $this->setter->apply($response);

        // RFC 6797: a server must not send Strict-Transport-Security over a
        // non-secure (plain HTTP) connection — the header has no defined
        // meaning there. Sending it anyway is actively harmful in local/dev:
        // if a browser ever sees it once over HTTPS for this host (even by
        // accident), it force-upgrades every future http:// request to
        // https://, which then fails outright wherever TLS isn't actually
        // terminated (e.g. local Docker nginx with SSL disabled).
        if (!$request->secure()) {
            $response->headers->remove('Strict-Transport-Security');
        }

        return $response;
    }
}
