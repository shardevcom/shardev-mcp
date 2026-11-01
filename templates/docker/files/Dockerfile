# syntax=docker/dockerfile:1

# RoadRunner (servidor de Octane): se descarga de la imagen oficial al construir, con versión
# fijada; el binario NO va en el repositorio. Octane 2.x rechaza RoadRunner >= 3.
ARG RR_VERSION=2025.1.15
ARG PHP_VERSION=8.4
ARG NODE_VERSION=22

FROM ghcr.io/roadrunner-server/roadrunner:${RR_VERSION} AS roadrunner

# ---- Frontend: compila cada SPA a public/<build_dir> -------------------------------------------
FROM node:${NODE_VERSION}-alpine AS assets
RUN corepack enable
WORKDIR /var/www
COPY package.json pnpm-workspace.yaml .npmrc tsconfig.base.json tsconfig.json ./
COPY resources ./resources
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build

# ---- Dependencias PHP ------------------------------------------------------------------------
FROM php:${PHP_VERSION}-cli-alpine AS vendor
RUN apk add --no-cache git unzip libzip-dev oniguruma-dev libxml2-dev \
 && docker-php-ext-install bcmath zip pcntl sockets
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /var/www
COPY composer.json composer.lock* ./
COPY packages ./packages
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction --prefer-dist

# ---- Imagen final ----------------------------------------------------------------------------
FROM php:${PHP_VERSION}-cli-alpine

ARG UID=1000
ARG GID=1000
ARG USER=appuser
ARG GROUP=appgroup

RUN apk add --no-cache libzip libxml2 oniguruma sqlite-libs \
 && apk add --no-cache --virtual .build-deps $PHPIZE_DEPS libzip-dev oniguruma-dev libxml2-dev linux-headers \
 && docker-php-ext-install pdo_mysql bcmath zip pcntl sockets \
 && pecl install redis && docker-php-ext-enable redis \
 && apk del .build-deps \
 && rm -rf /var/cache/apk/* /tmp/pear

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY --from=roadrunner /usr/bin/rr /usr/local/bin/rr
COPY docker/php.ini /usr/local/etc/php/php.ini

# Usuario sin privilegios: el proceso nunca corre como root.
RUN addgroup -g ${GID} ${GROUP} && adduser -D -u ${UID} -G ${GROUP} ${USER}

WORKDIR /var/www
COPY --chown=${USER}:${GROUP} . .
COPY --from=vendor --chown=${USER}:${GROUP} /var/www/vendor ./vendor
COPY --from=assets --chown=${USER}:${GROUP} /var/www/public ./public

RUN mkdir -p storage/logs storage/framework/sessions storage/framework/views storage/framework/cache bootstrap/cache \
 && composer dump-autoload --no-dev --optimize --no-interaction \
 && chown -R ${USER}:${GROUP} storage bootstrap/cache \
 && chmod -R ug+rwX storage bootstrap/cache

USER ${USER}

EXPOSE 8000

# --log-level=info: RoadRunner reenvía el stderr de Laravel; sin el flag los ERROR no llegan a la salida del contenedor.
# Antes del primer arranque en un entorno nuevo (una vez por despliegue):
#   php artisan migrate --force && php artisan authentications:setup
CMD ["php", "artisan", "octane:start", "--server=roadrunner", "--host=0.0.0.0", "--port=8000", "--max-requests=500", "--log-level=info"]
