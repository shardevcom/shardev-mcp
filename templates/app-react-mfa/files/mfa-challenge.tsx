import { zodResolver } from '@hookform/resolvers/zod';
import { ProcessApiResponse, useAppDispatch, useData, useNavigate } from '@shardev/common';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import InputError from '@{{ app.key }}/components/input-error';
import { Button } from '@{{ app.key }}/components/ui/button';
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';
import { setAuth } from '@{{ app.key }}/reducers/slices/authSlice';
import { ROUTE } from '@{{ app.key }}/routes/paths';
import type { UserAuth } from '@{{ app.key }}/types';

const schema = z.object({ code: z.string().min(6, 'Escribe el código de tu app autenticadora o un código de recuperación').max(32) });

interface Props {
    /** Valor opaco que devolvió el login. Vive solo en memoria de este componente: no se persiste. */
    challenge: string;
    onCancel: () => void;
}

/** Segundo paso del login: el código TOTP (6 dígitos) o un código de recuperación. El backend responde igual a cualquier fallo. */
export default function MfaChallengeForm({ challenge, onCancel }: Props) {
    const api = useData();
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: '' } });

    const verify = async (values: z.infer<typeof schema>) => {
        setBusy(true);
        try {
            const r = await api.insert<UserAuth, { challenge: string; code: string }>('auth/mfa/verify', { challenge, code: values.code.trim() });
            if (!r.success || !r.data) throw new Error(r.message || 'Código inválido o vencido');
            dispatch(setAuth(r.data));
            navigate(ROUTE.HOME);
        } catch (error) {
            form.setError('root.serverError', { type: 'server', message: ProcessApiResponse<UserAuth>(error).message || 'Código inválido o vencido' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <form onSubmit={form.handleSubmit(verify)} className="grid gap-4" noValidate>
            <p className="text-sm text-muted-foreground">Esta cuenta tiene verificación en dos pasos. Escribe el código de tu app autenticadora o uno de tus códigos de recuperación.</p>
            <InputError message={form.formState.errors.root?.serverError?.message} />
            <div className="grid gap-2">
                <Label htmlFor="mfa-code">Código</Label>
                <Input id="mfa-code" autoComplete="one-time-code" aria-invalid={!!form.formState.errors.code} {...form.register('code')} />
                <InputError message={form.formState.errors.code?.message} />
            </div>
            <Button type="submit" disabled={busy}>
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                Verificar
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
                Volver
            </Button>
        </form>
    );
}
