<?php

namespace Shardevcom\Repositories;

use Illuminate\Contracts\Container\Container;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;
use Shardevcom\Repositories\Contracts\RepositoryInterface;

class RepositoryManager
{
    public function __construct(private readonly Container $container)
    {
    }

    public function make(string|Model $model, ?string $repositoryClass = null): RepositoryInterface
    {
        $model = $this->resolveModel($model);
        $repositoryClass ??= Repository::class;

        $repository = $this->container->make($repositoryClass, [
            'model' => $model,
        ]);

        if (!$repository instanceof RepositoryInterface) {
            throw new InvalidArgumentException(sprintf(
                'Repository class [%s] must implement [%s].',
                $repositoryClass,
                RepositoryInterface::class
            ));
        }

        return $repository;
    }

    private function resolveModel(string|Model $model): Model
    {
        if ($model instanceof Model) {
            return $model;
        }

        if (!class_exists($model)) {
            throw new InvalidArgumentException(sprintf('Model class [%s] does not exist.', $model));
        }

        $instance = $this->container->make($model);

        if (!$instance instanceof Model) {
            throw new InvalidArgumentException(sprintf('Class [%s] must be an Eloquent model.', $model));
        }

        return $instance;
    }
}
