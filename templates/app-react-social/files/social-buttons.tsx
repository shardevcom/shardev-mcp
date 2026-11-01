import { ProcessApiResponse, useAppDispatch, useData, useNavigate } from '@shardev/common';
import { useEffect, useRef, useState } from 'react';
import InputError from '@{{ app.key }}/components/input-error';
import { Button } from '@{{ app.key }}/components/ui/button';
import { setAuth } from '@{{ app.key }}/reducers/slices/authSlice';
import { ROUTE } from '@{{ app.key }}/routes/paths';
import type { UserAuth } from '@{{ app.key }}/types';

interface ProviderInfo {
    provider: 'google' | 'microsoft';
    client_id: string;
    tenant?: string;
}

const STORAGE = '{{ app.key }}-social-flow';
const LABEL: Record<ProviderInfo['provider'], string> = { google: 'Continuar con Google', microsoft: 'Continuar con Microsoft' };

const random = (): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Lee el payload SIN confiar en él: solo para comparar el nonce que este navegador generó. El backend verifica la firma. */
const nonceOf = (idToken: string): string | null => {
    try {
        const part = idToken.split('.')[1] ?? '';
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
        const nonce = (JSON.parse(json) as { nonce?: unknown }).nonce;
        return typeof nonce === 'string' ? nonce : null;
    } catch {
        return null;
    }
};

interface Flow {
    state: string;
    nonce: string;
    provider: ProviderInfo['provider'];
}

function readFlow(saved: string | null): Flow | null {
    try {
        return saved ? (JSON.parse(saved) as Flow) : null;
    } catch {
        return null;
    }
}

function authorizeUrl(p: ProviderInfo, state: string, nonce: string): string {
    const redirect = `${window.location.origin}${ROUTE.SIGNIN}`;
    const query = new URLSearchParams({ client_id: p.client_id, response_type: 'id_token', redirect_uri: redirect, scope: 'openid email profile', state, nonce });
    if (p.provider === 'google') return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
    query.set('response_mode', 'fragment');
    return `https://login.microsoftonline.com/${encodeURIComponent(p.tenant ?? 'consumers')}/oauth2/v2.0/authorize?${query.toString()}`;
}

/**
 * Botones de inicio con proveedor. Redirección (response_type=id_token): se genera un `state` y un `nonce` aleatorios
 * que se guardan en sessionStorage; al volver se EXIGE que el state coincida y que el id_token traiga el mismo nonce,
 * y recién entonces se envía el id_token al backend, que verifica firma, emisor, audiencia y expiración.
 */
export default function SocialButtons() {
    const api = useData();
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [error, setError] = useState<string | undefined>();
    const handled = useRef(false);

    useEffect(() => {
        void api.fetch<ProviderInfo[]>('auth/social/providers').then((r) => {
            if (r.success && Array.isArray(r.data)) setProviders(r.data);
        });
    }, [api]);

    useEffect(() => {
        if (handled.current || !window.location.hash.includes('id_token=')) return;
        handled.current = true;
        const params = new URLSearchParams(window.location.hash.slice(1));
        // El fragmento lleva un token: se borra de la barra y del historial antes de hacer nada más.
        window.history.replaceState(null, '', window.location.pathname + window.location.search);

        const saved = sessionStorage.getItem(STORAGE);
        sessionStorage.removeItem(STORAGE);
        const idToken = params.get('id_token') ?? '';
        const flow = readFlow(saved);
        if (!flow || params.get('state') !== flow.state || nonceOf(idToken) !== flow.nonce) {
            setError('No se pudo validar la respuesta del proveedor. Inténtalo de nuevo.');
            return;
        }

        void api
            .insert<UserAuth, { id_token: string }>(`auth/social/${flow.provider}`, { id_token: idToken })
            .then((r) => {
                if (!r.success || !r.data) throw new Error(r.message || 'No se pudo iniciar sesión');
                dispatch(setAuth(r.data));
                navigate(ROUTE.HOME);
            })
            .catch((e: unknown) => setError(ProcessApiResponse<UserAuth>(e).message || 'No se pudo iniciar sesión'));
    }, [api, dispatch, navigate]);

    const start = (p: ProviderInfo) => {
        const state = random();
        const nonce = random();
        sessionStorage.setItem(STORAGE, JSON.stringify({ state, nonce, provider: p.provider }));
        window.location.assign(authorizeUrl(p, state, nonce));
    };

    if (providers.length === 0 && !error) return null;

    return (
        <div className="grid gap-2">
            <InputError message={error} />
            {providers.map((p) => (
                <Button key={p.provider} type="button" variant="outline" onClick={() => start(p)}>
                    {LABEL[p.provider]}
                </Button>
            ))}
        </div>
    );
}
