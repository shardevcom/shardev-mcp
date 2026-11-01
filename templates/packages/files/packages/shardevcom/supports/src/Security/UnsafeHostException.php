<?php

namespace Shardevcom\Supports\Security;

use RuntimeException;

/** El host no es un destino público permitido (ver PublicHostGuard). El mensaje es un código. */
class UnsafeHostException extends RuntimeException {}
