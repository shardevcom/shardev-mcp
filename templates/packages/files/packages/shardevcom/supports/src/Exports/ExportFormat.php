<?php

namespace Shardevcom\Supports\Exports;

use Illuminate\Support\Str;
use Shardevcom\Supports\Exceptions\UnsupportedExportFormatException;

class ExportFormat
{
    public static function resolve(
        string $resource,
        ?string $format = null
    ): array {

        $default = config(
            'supports.exports.default.format',
            'xlsx'
        );

        $format = $format ?: $default;

        $formats = config(
            'supports.exports.formats',
            []
        );

        if (! isset($formats[$format])) {
            throw new UnsupportedExportFormatException(
                $format,
                array_keys($formats)
            );
        }

        $config = $formats[$format];

        return [
            'format' => $format,
            'extension' => $config['extension'],
            'mime_type' => $config['mime_type'],
            'writer_type' => $config['writer_type'],
            'filename' => self::filename(
                $resource,
                $config['extension']
            ),
        ];
    }

    protected static function filename(
        string $resource,
        string $extension
    ): string {

        $config = config(
            'supports.exports.filename',
            []
        );

        $separator = $config['separator'] ?? '_';

        $segments = array_filter([
            $config['prefix'] ?? null,

            Str::snake(
                Str::singular($resource)
            ) . ($config['suffix'] ?? ''),

            now()->format(
                $config['date_format'] ?? 'Ymd_His'
            ),
        ]);

        return implode($separator, $segments)
            . ".{$extension}";
    }
}
