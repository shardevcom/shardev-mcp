<?php

namespace Shardevcom\Authentications\Http\Controllers;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Shardevcom\Authentications\Http\Requests\ChangePasswordRequest;
use Shardevcom\Authentications\Http\Requests\LoginRequest;
use Shardevcom\Authentications\Http\Requests\UpdateProfileRequest;
use Shardevcom\Authentications\Services\AccountAuthService;
use Shardevcom\Authentications\Support\AppRegistry;
use Shardevcom\Supports\Controllers\Controller;
use Shardevcom\Supports\Exceptions\UserFacingException;
use Shardevcom\Supports\Responses\JsonResponse;
use Throwable;

/**
 * Login / logout / perfil / cambio de contraseña de UNA app. Cada app genera una subclase con
 * `$app` fijo (su `key`); la app nunca se deduce de la petición.
 */
abstract class AccountAuthController extends Controller
{
    /** key de la app (config/authentications.php `apps`). */
    protected string $app;

    public function __construct(protected AccountAuthService $auth) {}

    /**
     * Este controlador no maneja un recurso de repositorio: envuelve el resultado con el mismo
     * formato de JsonResponse. Solo UserFacingException muestra su mensaje; lo demás es genérico.
     */
    protected function respond(string $action, callable $callback, int $code = 200)
    {
        try {
            return JsonResponse::resourceSuccess('auth', $action, $callback(), $code);
        } catch (HttpResponseException $e) {
            return $e->getResponse();
        } catch (UserFacingException $e) {
            return JsonResponse::fromThrowable($e);
        } catch (Throwable $e) {
            return JsonResponse::resourceException($e, 'auth', $action);
        }
    }

    protected function guard(): string
    {
        return AppRegistry::get($this->app)['guard'];
    }

    public function signin(LoginRequest $request)
    {
        return $this->respond('signin', fn () => $this->auth->login($this->app, $request->validated()));
    }

    public function logout(Request $request)
    {
        return $this->respond('logout', function () use ($request) {
            $this->auth->logout($request->user($this->guard()));

            return [];
        });
    }

    public function me(Request $request)
    {
        return $this->respond('me', fn () => $this->auth->profile($request->user($this->guard())));
    }

    public function updateProfile(UpdateProfileRequest $request)
    {
        return $this->respond('updateProfile', fn () => $this->auth->updateProfile($request->user($this->guard()), $request->validated()));
    }

    public function changePassword(ChangePasswordRequest $request)
    {
        return $this->respond('changePassword', fn () => $this->auth->changePassword($this->app, $request->user($this->guard()), $request->validated()));
    }
}
