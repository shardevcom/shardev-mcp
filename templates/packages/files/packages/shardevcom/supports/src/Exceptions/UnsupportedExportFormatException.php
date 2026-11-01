<?php

namespace Shardevcom\Supports\Exceptions;

use Symfony\Component\HttpKernel\Exception\HttpException;

class UnsupportedExportFormatException extends HttpException
{
    public function __construct(
        string $format,
        array $availableFormats = [],
        int $statusCode = 422
    ) {
        parent::__construct(
            $statusCode,
            __('messages.exports.unsupported_format', [
                'format' => $format,
                'formats' => implode(', ', $availableFormats),
            ])
        );
    }
}
