<?php

namespace Shardevcom\Supports\Services\Security;


use Shardevcom\Supports\Contracts\HeaderSetterInterface;
use Shardevcom\Supports\Contracts\SecurityConfigInterface;
use Symfony\Component\HttpFoundation\Response;

class HeaderSetter implements HeaderSetterInterface
{
    public function __construct(protected SecurityConfigInterface $config) {}

    public function apply(Response $response): void
    {
        foreach ($this->config->headers() as $header => $option) {
            $this->setHeaderOptions($response, $header, $option);
        }
    }

    protected function setHeaderOptions(Response $response, string $header, $options): void
    {
        if (empty($options)) {
            return;
        }

        if (is_array($options)) {
            $delimiter = $this->getDelimiter($header);
            $value = $delimiter ? implode($delimiter, $options) : $options;
            $response->headers->set($header, is_array($value) ? end($value) : $value);
        } else {
            $response->headers->set($header, $options);
        }
    }

    protected function getDelimiter(string $header): ?string
    {
        return in_array($header, $this->config->optionsToString()) ? '; ' : null;
    }
}

