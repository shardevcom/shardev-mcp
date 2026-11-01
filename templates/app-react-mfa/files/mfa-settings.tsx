import { useData } from '@shardev/common';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@{{ app.key }}/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';

interface MfaStatus {
    enabled: boolean;
    pending: boolean;
    recovery_codes_remaining: number;
}
interface MfaSetup {
    secret: string;
    otpauth_url: string;
}
interface MfaCodes {
    recovery_codes: string[];
}

/**
 * Verificación en dos pasos (TOTP) de esta cuenta. Sin librería de QR: se muestra el secreto y un enlace
 * `otpauth://` que abren las apps autenticadoras. Los códigos de recuperación se ven UNA sola vez y viven solo
 * en el estado de este componente (nunca en el store persistido). Activarla o desactivarla cierra las demás sesiones.
 */
export default function MfaSettings() {
    const api = useData();
    const [status, setStatus] = useState<MfaStatus | null>(null);
    const [setup, setSetup] = useState<MfaSetup | null>(null);
    const [codes, setCodes] = useState<string[] | null>(null);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = await api.fetch<MfaStatus>('auth/mfa');
        if (r.success && r.data) setStatus(r.data);
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    const run = async (action: () => Promise<void>, failure: string) => {
        setBusy(true);
        try {
            await action();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : failure);
        } finally {
            setBusy(false);
        }
    };

    const start = () =>
        run(async () => {
            const r = await api.insert<MfaSetup, Record<string, never>>('auth/mfa/setup', {});
            if (!r.success || !r.data) throw new Error(r.message);
            setSetup(r.data);
            setCodes(null);
        }, 'No se pudo iniciar la activación');

    const confirm = () =>
        run(async () => {
            const r = await api.insert<MfaCodes, { code: string }>('auth/mfa/confirm', { code: code.trim() });
            if (!r.success || !r.data) throw new Error(r.message);
            setCodes(r.data.recovery_codes);
            setSetup(null);
            setCode('');
            toast.success('Verificación en dos pasos activada; las demás sesiones se cerraron');
            await load();
        }, 'Código inválido');

    const regenerate = () =>
        run(async () => {
            const r = await api.insert<MfaCodes, { password: string; code: string }>('auth/mfa/recovery-codes', { password, code: code.trim() });
            if (!r.success || !r.data) throw new Error(r.message);
            setCodes(r.data.recovery_codes);
            setCode('');
            setPassword('');
            await load();
        }, 'Contraseña o código inválidos');

    const disable = () =>
        run(async () => {
            const r = await api.insert<{ enabled: boolean }, { password: string; code: string }>('auth/mfa/disable', { password, code: code.trim() });
            if (!r.success) throw new Error(r.message);
            setCodes(null);
            setCode('');
            setPassword('');
            toast.success('Verificación en dos pasos desactivada; las demás sesiones se cerraron');
            await load();
        }, 'Contraseña o código inválidos');

    return (
        <Card>
            <CardHeader>
                <CardTitle>Verificación en dos pasos</CardTitle>
                <CardDescription>
                    {status?.enabled ? `Activada. Códigos de recuperación disponibles: ${status.recovery_codes_remaining}.` : 'Protege tu cuenta con un código de una app autenticadora además de la contraseña.'}
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
                {codes && (
                    <div className="grid gap-2" role="alert">
                        <p className="text-sm font-medium">Guarda estos códigos de recuperación. No se volverán a mostrar y cada uno sirve una sola vez.</p>
                        <pre className="rounded-md bg-muted p-3 text-sm">{codes.join('\n')}</pre>
                        <Button className="w-fit" variant="outline" onClick={() => setCodes(null)}>
                            Ya los guardé
                        </Button>
                    </div>
                )}

                {status && !status.enabled && !setup && (
                    <Button className="w-fit" onClick={start} disabled={busy}>
                        Activar
                    </Button>
                )}

                {setup && (
                    <div className="grid gap-3">
                        <p className="text-sm">
                            Añade esta clave en tu app autenticadora (o abre el <a className="underline" href={setup.otpauth_url}>enlace otpauth</a>) y escribe el código que muestra.
                        </p>
                        <code className="break-all rounded-md bg-muted p-2 text-sm">{setup.secret}</code>
                        <div className="grid gap-2">
                            <Label htmlFor="mfa-confirm">Código de 6 dígitos</Label>
                            <Input id="mfa-confirm" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
                        </div>
                        <Button className="w-fit" onClick={confirm} disabled={busy || code.trim().length < 6}>
                            Confirmar
                        </Button>
                    </div>
                )}

                {status?.enabled && (
                    <div className="grid gap-3">
                        <p className="text-sm text-muted-foreground">Para generar códigos nuevos o desactivarla se piden tu contraseña actual y un código válido.</p>
                        <div className="grid gap-2">
                            <Label htmlFor="mfa-password">Contraseña actual</Label>
                            <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="mfa-current-code">Código (app autenticadora o de recuperación)</Label>
                            <Input id="mfa-current-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={regenerate} disabled={busy || password === '' || code.trim().length < 6}>
                                Generar códigos nuevos
                            </Button>
                            <Button variant="destructive" onClick={disable} disabled={busy || password === '' || code.trim().length < 6}>
                                Desactivar
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
