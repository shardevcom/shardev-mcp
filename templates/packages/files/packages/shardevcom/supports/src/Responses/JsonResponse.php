<?php

namespace Shardevcom\Supports\Responses;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\JsonResponse as HttpJsonResponse;
use Maatwebsite\Excel\Exceptions\NoTypeDetectedException;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\Lang;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Shardevcom\Repositories\Repository;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Illuminate\Http\Exceptions\HttpResponseException;
use Throwable;


class JsonResponse
{
    /**
     * Reemplazos compatibles con strtr.
     */
    protected static function replacements(array $replace = []): array
    {
        return collect($replace)
            ->mapWithKeys(fn($value, $key) => [":{$key}" => $value])
            ->toArray();
    }

    /**
     * Traduce una clave o retorna fallback.
     */
    protected static function translate(
        string  $key,
        array   $replace = [],
        ?string $fallback = null
    ): string
    {
        if (Lang::has($key)) {
            return __($key, $replace);
        }

        return $fallback
            ? strtr($fallback, self::replacements($replace))
            : $key;
    }

    /**
     * Nombre legible del recurso.
     */
    protected static function resourceName(string $resource): string
    {
        return Str::headline(
            Str::singular($resource)
        );
    }

    /**
     * Genera fallback automático.
     */
    protected static function generatedFallback(
        string $resource,
        string $action,
        bool   $success
    ): string
    {
        $resource = self::resourceName($resource);

        return match ($action) {

            'insert' => $success
                ? "{$resource} created successfully."
                : "Unable to create {$resource}.",

            'update' => $success
                ? "{$resource} updated successfully."
                : "Unable to update {$resource}.",

            'remove' => $success
                ? "{$resource} removed successfully."
                : "{$resource} not found.",

            'fetch' => $success
                ? "{$resource} fetched successfully."
                : "Unable to fetch {$resource}.",

            'fetchMany' => $success
                ? "{$resource} collection fetched successfully."
                : "Unable to fetch {$resource} collection.",

            'find', 'findBy' => $success
                ? "{$resource} found successfully."
                : "{$resource} not found.",

            'updateMany' => $success
                ? "{$resource} collection updated successfully."
                : "Unable to update {$resource} collection.",

            'deleteMany' => $success
                ? "{$resource} collection removed successfully."
                : "Unable to remove {$resource} collection.",

            'upsert' => $success
                ? "{$resource} upsert completed successfully."
                : "Unable to upsert {$resource}.",

            'updateOrCreate' => $success
                ? "{$resource} updated or created successfully."
                : "Unable to update or create {$resource}.",

            'firstOrCreate' => $success
                ? "{$resource} retrieved or created successfully."
                : "Unable to retrieve or create {$resource}.",

            'firstOrNew' => $success
                ? "{$resource} instantiated successfully."
                : "Unable to instantiate {$resource}.",

            default => $success
                ? __('messages.success')
                : __('messages.unexpected_error'),
        };
    }

    /**
     * Resuelve mensajes de recursos.
     *
     * Orden:
     * 1. messages.resources.{resource}.{action}.{status}
     * 2. messages.resources.default.{action}.{status}
     * 3. fallback generado
     */
    public static function resourceMessage(
        string  $resource,
        string  $action,
        bool    $success = true,
        ?string $fallback = null
    ): string
    {
        $status = $success ? 'success' : 'error';

        $replace = [
            'resource' => self::resourceName($resource),
        ];

        $resourceKey = sprintf(
            'messages.resources.%s.%s.%s',
            Str::snake($resource),
            $action,
            $status
        );

        if (Lang::has($resourceKey)) {
            return __($resourceKey, $replace);
        }

        $defaultKey = sprintf(
            'messages.resources.default.%s.%s',
            $action,
            $status
        );

        if (Lang::has($defaultKey)) {
            return __($defaultKey, $replace);
        }

        return $fallback
            ? strtr($fallback, self::replacements($replace))
            : self::generatedFallback(
                $resource,
                $action,
                $success
            );
    }

    /**
     * Success response.
     */
    public static function success(
        mixed  $data = null,
        string $message = 'messages.success',
        int    $status = 200
    ): HttpJsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => self::translate($message),
            'data' => $data,
            'errors' => null,
            'status' => $status,
        ], $status);
    }

    /**
     * Error response.
     */
    public static function error(
        string $message,
        int    $status = 400,
        array  $errors = []
    ): HttpJsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => self::translate($message),
            'data' => null,
            'errors' => empty($errors) ? null : $errors,
            'status' => $status,
        ], $status);
    }

    /**
     * Resource success response.
     */
    public static function resourceSuccess(
        string  $resource,
        string  $action,
        mixed   $data = null,
        int     $status = 200,
        ?string $fallback = null
    ): HttpJsonResponse
    {
        return response()->json([
            'success' => true,
            'message' => self::resourceMessage(
                $resource,
                $action,
                true,
                $fallback
            ),
            'data' => $data,
            'errors' => null,
            'status' => $status,
        ], $status);
    }

    /**
     * Resource error response.
     */
    public static function resourceError(
        string  $resource,
        string  $action,
        int     $status = 400,
        array   $errors = [],
        ?string $fallback = null
    ): HttpJsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => self::resourceMessage(
                $resource,
                $action,
                false,
                $fallback
            ),
            'data' => null,
            'errors' => empty($errors) ? null : $errors,
            'status' => $status,
        ], $status);
    }

    /**
     * Validation response.
     */
    public static function validationError(
        mixed  $errors,
        string $message = 'messages.validation_failed',
        int    $status = 422
    ): HttpJsonResponse
    {
        return self::error(
            $message,
            $status,
            (array)$errors
        );
    }

    /**
     * Exception response.
     */
    public static function exception(
        Throwable $e,
        string    $message = 'messages.unexpected_error',
        int       $code = 500,
        array     $context = [],
        ?string   $logChannel = 'stack',
        bool      $report = true
    ): HttpJsonResponse
    {
        // $report = false when the framework's exception handler already
        // reports the exception, so it is logged exactly once.
        if ($report) {
            $log = $logChannel
                ? Log::channel($logChannel)
                : Log::stack(['single', 'daily']);

            $log->error(
                $e->getMessage(),
                array_merge([
                    'exception' => get_class($e),
                    'file' => $e->getFile(),
                    'line' => $e->getLine(),
                    'trace' => config('app.debug')
                        ? $e->getTrace()
                        : [],
                ], $context)
            );
        }

        return self::error(
            $message,
            $code,
            config('app.debug')
                ? ['exception' => $e->getMessage()]
                : []
        );
    }

    /**
     * Single rule that turns any exception into an API response.
     *
     * Only a UserFacingException publishes its own message. Everything else is
     * answered with a message the client may safely see; the internal detail
     * stays in the log and, with app.debug, in `errors`.
     *
     * $report = false when the framework's exception handler already reported
     * the exception (the global render in bootstrap/app.php).
     */
    public static function fromThrowable(Throwable $e, bool $report = true): Response
    {
        if ($e instanceof UserFacingException) {
            return self::error($e->getUserMessage(), $e->getStatusCode(), $e->getErrors());
        }

        // A ValidationException keeps the status it was thrown with
        // (->status(429) for a wait, for instance); the field messages stay in `errors`.
        if ($e instanceof ValidationException) {
            return self::validationError(
                $e->errors(),
                $e->status === 429 ? 'messages.too_many_requests' : 'messages.validation_failed',
                $e->status
            );
        }

        if ($e instanceof AuthenticationException
            || is_a($e, 'League\OAuth2\Server\Exception\OAuthServerException')) {
            return self::error('messages.unauthenticated', 401);
        }

        // AGREGADO: Manejo de Autorización / Políticas (Policies / Gates) de Laravel
        if ($e instanceof AuthorizationException) {
            return self::error('messages.forbidden', 403);
        }

        if ($e instanceof HttpResponseException) {
            return $e->getResponse();
        }

        if ($e instanceof HttpExceptionInterface) {
            $status = $e->getStatusCode();

            return self::error(self::httpErrorMessage($status, $e->getMessage()), $status)
                ->withHeaders($e->getHeaders());
        }

        return self::exception($e, report: $report);
    }

    /**
     * Message for an HTTP exception. 404/405/429 and 5xx always use a fixed
     * text: Laravel fills the 404 message with the model class of a
     * ModelNotFoundException, and the 405 one with the route's methods.
     * Other 4xx messages are the ones our own abort() calls write.
     */
    protected static function httpErrorMessage(int $status, string $message): string
    {
        return match (true) {
            $status === 404 => 'messages.not_found',
            $status === 405 => 'messages.method_not_allowed',
            $status === 429 => 'messages.too_many_requests',
            $status >= 500 => 'messages.unexpected_error',
            $message !== '' => $message,
            $status === 401 => 'messages.unauthenticated',
            $status === 403 => 'messages.forbidden',
            default => 'messages.unexpected_error',
        };
    }

    /**
     * Resource exception response.
     */
    public static function resourceException(
        Throwable $e,
        string    $resource,
        string    $action,
        int       $code = 500,
        array     $context = [],
        ?string   $logChannel = 'stack',
        ?string   $fallbackMessage = null
    ): HttpJsonResponse
    {
        $log = $logChannel
            ? Log::channel($logChannel)
            : Log::stack(['single', 'daily']);

        $log->error(
            "[{$resource}.{$action}] {$e->getMessage()}",
            array_merge([
                'resource' => $resource,
                'action' => $action,
                'exception' => get_class($e),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
                'trace' => config('app.debug')
                    ? $e->getTrace()
                    : [],
            ], $context)
        );

        return self::resourceError(
            resource: $resource,
            action: $action,
            status: $code,
            errors: config('app.debug')
                ? [
                    'message' => $e->getMessage(),
                    'exception' => get_class($e),
                    'file' => $e->getFile(),
                    'line' => $e->getLine(),
                ]
                : [],
            fallback: $fallbackMessage
        );
    }

    /**
     * Resource validation response.
     */
    public static function resourceValidationError(
        string  $resource,
        string  $action,
        mixed   $errors,
        ?string $fallback = null
    ): HttpJsonResponse
    {
        return self::resourceError(
            resource: $resource,
            action: $action,
            status: 422,
            errors: (array)$errors,
            fallback: $fallback
        );
    }

    /**
     * Wrapper automático para repositorios.
     */
    public static function execute(
        Repository $repository,
        string     $action,
        callable   $callback,
        ?int       $successCode = 200,
    ): Response
    {
        try {

            $result = $callback();

            if ($result instanceof Response) {
                return $result;
            }

            if (
                $result === null &&
                in_array($action, ['find', 'update', 'remove'])
            ) {
                return self::resourceError(
                    $repository->getResource(),
                    $action,
                    404
                );
            }

            return self::resourceSuccess(
                $repository->getResource(),
                $action,
                $result,
                $successCode
            );

        } catch (HttpExceptionInterface $e) {
            return self::fromThrowable($e);
        } catch (HttpResponseException $e) {
            return $e->getResponse();
        }  catch (ValidationException $e) {
            if ($e->status !== 422) {
                return self::fromThrowable($e);
            }

            return self::resourceValidationError(
                $repository->getResource(),
                $action,
                $e->errors()
            );
        } catch (ModelNotFoundException $e) {
            return self::resourceError(
                $repository->getResource(),
                $action,
                404
            );
        } catch (NoTypeDetectedException $e) {
            return self::resourceValidationError(
                $repository->getResource(),
                $action,
                $e->getMessage()
            );
        } catch (UserFacingException $e) {
            return self::fromThrowable($e);
        } catch (Throwable $e) {
            return self::resourceException(
                $e,
                $repository->getResource(),
                $action
            );
        }
    }
}
