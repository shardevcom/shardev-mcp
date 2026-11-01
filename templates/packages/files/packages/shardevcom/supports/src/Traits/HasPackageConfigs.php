<?php

namespace Shardevcom\Supports\Traits;

use Illuminate\Support\Facades\File;

trait HasPackageConfigs
{
    public function getConfigs(): array
    {
        $basePath = base_path(config('supports.packages.directory', 'packages'));
        $vendor = config('supports.packages.vendor');
        $configs = [];

        if (is_dir($basePath)) {
            $vendorPaths = $vendor
                ? [$basePath . DIRECTORY_SEPARATOR . $vendor]
                : File::directories($basePath);

            foreach ($vendorPaths as $vendorPath) {
                if (!is_dir($vendorPath)) continue;

                foreach (File::directories($vendorPath) as $directory) {
                    $packageName = basename($directory);
                    if ($packageName === 'stubs' || str_contains($packageName, '{{')) continue;

                    $configPath = $directory . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . $packageName . '.php';

                    if (File::exists($configPath)) {
                        $packageConfig = include $configPath;
                        $configs = $this->smartMerge($configs, $packageConfig);
                    }
                }
            }
        }

        if ($vendor) {
            $vendorName = strtolower($vendor);
            $vendorConfigPath = config_path($vendorName . '.php');
            if (File::exists($vendorConfigPath)) {
                $vendorConfigValues = include $vendorConfigPath;
                $configs = $this->smartMerge($configs, $vendorConfigValues);
            }
        }

        return $configs;
    }

    protected function smartMerge(array $base, array $override): array
    {
        foreach ($override as $key => $value) {
            // 1. Eliminar versiones "string" si ahora viene una definición "array" (o viceversa)
            if (!is_int($key)) {
                foreach ($base as $baseKey => $baseValue) {
                    if (is_int($baseKey) && $baseValue === $key) {
                        unset($base[$baseKey]);
                    }
                }
            }

            // 2. Lógica de mezcla
            if (is_array($value) && isset($base[$key]) && is_array($base[$key])) {
                if ($this->isList($value)) {
                    // Combinamos las listas
                    $merged = array_merge($base[$key], $value);

                    // Solo usamos array_unique si NO hay arrays internos (evita el Error)
                    $hasMulti = collect($merged)->contains(fn($item) => is_array($item));

                    $base[$key] = $hasMulti ? $merged : array_unique($merged);
                } else {
                    $base[$key] = $this->smartMerge($base[$key], $value);
                }
            } else {
                $base[$key] = $value;
            }
        }

        return $base;
    }

    protected function isList(array $array): bool
    {
        if ([] === $array) return true;
        return array_keys($array) === range(0, count($array) - 1);
    }
}
