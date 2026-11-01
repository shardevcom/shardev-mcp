<?php

namespace Shardevcom\Supports\Security;

/**
 * SSRF: verifica que un host controlado por el usuario (p. ej. el
 * servidor IMAP de una cuenta de correo) resuelva SOLO a direcciones públicas.
 *
 * Se rechaza si el nombre o CUALQUIERA de sus IPs resueltas (A y AAAA) es:
 * loopback, privada (RFC 1918 / ULA), link-local (incl. 169.254.169.254, metadata
 * de nube), CGNAT, reservada, multicast, no especificada, o IPv4 mapeada en IPv6
 * hacia alguna de ellas; así como nombres internos (localhost, *.local,
 * *.internal, metadata.google.internal…).
 *
 * Debe llamarse al guardar el host Y otra vez justo antes de conectar (después de
 * resolver el DNS), para no depender de una validación hecha con otra resolución.
 */
class PublicHostGuard
{
    /** @var (callable(string): list<string>)|null resolver de DNS (inyectable en tests) */
    protected static $resolver = null;

    private const BLOCKED_NAMES = ['localhost', 'metadata', 'metadata.google.internal', 'instance-data'];

    private const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa'];

    /** Rangos IPv4 adicionales a los de FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE. */
    private const EXTRA_BLOCKED_V4 = [
        '0.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '192.0.0.0/24',
        '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
    ];

    public static function resolveUsing(?callable $resolver): void
    {
        static::$resolver = $resolver;
    }

    public static function isPublic(string $host): bool
    {
        try {
            static::assertPublic($host);

            return true;
        } catch (UnsafeHostException) {
            return false;
        }
    }

    /**
     * @return list<string> IPs resueltas (todas públicas)
     *
     * @throws UnsafeHostException
     */
    public static function assertPublic(string $host): array
    {
        $host = strtolower(trim($host));
        $host = trim($host, '[]');
        $host = rtrim($host, '.');

        if ($host === '' || strlen($host) > 253 || preg_match('/[^a-z0-9.\-:]/', $host)) {
            throw new UnsafeHostException('invalid_host');
        }

        if (in_array($host, self::BLOCKED_NAMES, true)) {
            throw new UnsafeHostException('internal_hostname');
        }

        foreach (self::BLOCKED_SUFFIXES as $suffix) {
            if (str_ends_with($host, $suffix)) {
                throw new UnsafeHostException('internal_hostname');
            }
        }

        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : static::resolve($host);

        if ($ips === []) {
            throw new UnsafeHostException('unresolvable_host');
        }

        foreach ($ips as $ip) {
            if (! static::ipIsPublic($ip)) {
                throw new UnsafeHostException('non_public_address');
            }
        }

        return $ips;
    }

    public static function ipIsPublic(string $ip): bool
    {
        if (! filter_var($ip, FILTER_VALIDATE_IP)) {
            return false;
        }

        // IPv4 mapeada/compatible en IPv6 (::ffff:10.0.0.1): se evalúa como IPv4.
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) && preg_match('/^::(ffff:)?(\d{1,3}(\.\d{1,3}){3})$/i', $ip, $m)) {
            return static::ipIsPublic($m[2]);
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            foreach (self::EXTRA_BLOCKED_V4 as $cidr) {
                if (static::inCidrV4($ip, $cidr)) {
                    return false;
                }
            }

            return true;
        }

        // IPv6: además de los rangos de PHP, ULA (fc00::/7), link-local (fe80::/10),
        // site-local (fec0::/10), multicast (ff00::/8) y NAT64 (64:ff9b::/96).
        $first = strtolower(explode(':', $ip)[0] ?? '');
        $word = $first === '' ? 0 : hexdec($first);

        return ! (
            ($word & 0xFE00) === 0xFC00
            || ($word & 0xFFC0) === 0xFE80
            || ($word & 0xFFC0) === 0xFEC0
            || ($word & 0xFF00) === 0xFF00
            || str_starts_with(strtolower($ip), '64:ff9b:')
            || $ip === '::' || $ip === '::1'
        );
    }

    /** @return list<string> */
    protected static function resolve(string $host): array
    {
        if (static::$resolver) {
            return array_values((static::$resolver)($host));
        }

        $ips = gethostbynamel($host) ?: [];

        foreach (@dns_get_record($host, DNS_AAAA) ?: [] as $record) {
            if (! empty($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }

        return array_values(array_unique($ips));
    }

    private static function inCidrV4(string $ip, string $cidr): bool
    {
        [$subnet, $bits] = explode('/', $cidr);
        $mask = -1 << (32 - (int) $bits);

        return (ip2long($ip) & $mask) === (ip2long($subnet) & $mask);
    }
}
