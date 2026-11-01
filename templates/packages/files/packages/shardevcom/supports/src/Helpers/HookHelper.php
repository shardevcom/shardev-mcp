<?php

namespace Shardevcom\Supports\Helpers;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Log;
use ReflectionMethod;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

class HookHelper
{
    /**
     * Hooks whose contract is authorization (the `HasAuthorizable` set).
     * An unexpected exception in one of these must fail CLOSED (deny the
     * request), never silently fall back to the unmodified payload — a
     * fallback here means "no authorization check ran", which is the wrong
     * failure direction for a security control.
     */
    private const AUTHORIZATION_HOOKS = [
        'applyOnFilter',
        'applyOnInsert',
        'applyOnUpdate',
        'applyOnUpsert',
        'applyOnDelete',
    ];

    /**
     * Ejecuta un hook informativo.
     *
     * No espera retorno.
     *
     * Ideal para:
     * - beforeDelete
     * - afterInsert
     * - afterFetch
     * - afterUpdate
     */
    public static function run(
        object $target,
        string $hook,
        mixed ...$args
    ): void {
        if (! method_exists($target, $hook)) {
            return;
        }

        try {
            self::invoke($target, $hook, $args);
        } catch (HttpExceptionInterface|AuthorizationException $e) {
            // abort()/authorize() inside a hook is an intentional "deny the
            // request" signal, not a hook malfunction — let it reach
            // Laravel's normal exception handler instead of being logged
            // and silently discarded.
            throw $e;
        } catch (Throwable $e) {
            self::logError($target, $hook, $args, $e);
        }
    }

    /**
     * Ejecuta un hook mutable.
     *
     * El primer argumento SIEMPRE es el payload mutable.
     * El resto son argumentos de contexto.
     *
     * Ejemplo:
     *
     * $data = HookHelper::pipe(
     *     $this,
     *     'beforeUpdate',
     *     $data,
     *     $model
     * );
     *
     * Hook:
     *
     * protected function beforeUpdate(
     *     array $data,
     *     Model $model
     * ): array
     */
    public static function pipe(
        object $target,
        string $hook,
        mixed $payload,
        mixed ...$context
    ): mixed {
        if (! method_exists($target, $hook)) {
            return $payload;
        }

        $args = [$payload, ...$context];

        try {
            $result = self::invoke($target, $hook, $args);

            return $result !== null
                ? $result
                : $payload;

        } catch (HttpExceptionInterface|AuthorizationException $e) {
            // Same reasoning as run() above — never swallow an intentional
            // authorization denial.
            throw $e;
        } catch (Throwable $e) {
            self::logError($target, $hook, $args, $e);

            if (in_array($hook, self::AUTHORIZATION_HOOKS, true)) {
                // fail closed. Returning $payload here would mean
                // the authorization check silently never ran.
                throw $e;
            }

            return $payload;
        }
    }

    /**
     * Ejecuta el método soportando referencias (&)
     *
     * @throws \ReflectionException
     */
    protected static function invoke(
        object $target,
        string $hook,
        array $args = []
    ): mixed {
        $method = new ReflectionMethod($target, $hook);

        $byReference = false;

        foreach ($method->getParameters() as $parameter) {
            if ($parameter->isPassedByReference()) {
                $byReference = true;
                break;
            }
        }

        return $method->invokeArgs(
            $target,
            $byReference
                ? self::toReferenceArray($args)
                : $args
        );
    }

    /**
     * Convierte un array en referencias (&)
     */
    protected static function toReferenceArray(array &$array): array
    {
        $references = [];

        foreach ($array as $key => &$value) {
            $references[$key] = &$value;
        }

        return $references;
    }

    /**
     * Centraliza logs de errores
     */
    protected static function logError(
        object $target,
        string $hook,
        array $args,
        Throwable $e
    ): void {
        Log::warning(
            "⚠️ Error ejecutando hook '{$hook}': {$e->getMessage()}",
            [
                'target' => get_class($target),
                'hook' => $hook,
                'args' => $args,
                'exception' => $e,
            ]
        );
    }
}
