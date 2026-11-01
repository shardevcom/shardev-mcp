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

const emailSchema = z.object({ email: z.string().min(1, 'El correo es obligatorio').email('Correo inválido') });
const codeSchema = z.object({ code: z.string().min(4, 'Escribe el código que recibiste').max(12) });

/** Entrada por código enviado al correo, en dos pasos. El backend responde igual exista o no la cuenta. */
export default function OtpForm() {
    const api = useData();
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const [email, setEmail] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const emailForm = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema), defaultValues: { email: '' } });
    const codeForm = useForm<z.infer<typeof codeSchema>>({ resolver: zodResolver(codeSchema), defaultValues: { code: '' } });

    const ask = async (values: z.infer<typeof emailSchema>) => {
        setBusy(true);
        try {
            const r = await api.insert<unknown, { email: string }>('auth/otp/request', { email: values.email });
            if (!r.success) throw new Error(r.message);
            setEmail(values.email);
        } catch (error) {
            emailForm.setError('root.serverError', { type: 'server', message: ProcessApiResponse<unknown>(error).message || 'No se pudo pedir el código' });
        } finally {
            setBusy(false);
        }
    };

    const verify = async (values: z.infer<typeof codeSchema>) => {
        if (email === null) return;
        setBusy(true);
        try {
            const r = await api.insert<UserAuth, { email: string; code: string }>('auth/otp/verify', { email, code: values.code.trim() });
            if (!r.success || !r.data) throw new Error(r.message || 'Código inválido o vencido');
            dispatch(setAuth(r.data));
            navigate(ROUTE.HOME);
        } catch (error) {
            codeForm.setError('root.serverError', { type: 'server', message: ProcessApiResponse<UserAuth>(error).message || 'Código inválido o vencido' });
        } finally {
            setBusy(false);
        }
    };

    if (email === null) {
        return (
            <form onSubmit={emailForm.handleSubmit(ask)} className="grid gap-4" noValidate>
                <InputError message={emailForm.formState.errors.root?.serverError?.message} />
                <div className="grid gap-2">
                    <Label htmlFor="email">Correo</Label>
                    <Input id="email" type="email" autoComplete="username" aria-invalid={!!emailForm.formState.errors.email} {...emailForm.register('email')} />
                    <InputError message={emailForm.formState.errors.email?.message} />
                </div>
                <Button type="submit" disabled={busy}>
                    {busy && <LoaderCircle className="size-4 animate-spin" />}
                    Enviar código
                </Button>
            </form>
        );
    }

    return (
        <form onSubmit={codeForm.handleSubmit(verify)} className="grid gap-4" noValidate>
            <p className="text-sm text-muted-foreground">Si el correo tiene cuenta, enviamos un código a {email}. Vence pronto y sirve una sola vez.</p>
            <InputError message={codeForm.formState.errors.root?.serverError?.message} />
            <div className="grid gap-2">
                <Label htmlFor="code">Código</Label>
                <Input id="code" inputMode="numeric" autoComplete="one-time-code" aria-invalid={!!codeForm.formState.errors.code} {...codeForm.register('code')} />
                <InputError message={codeForm.formState.errors.code?.message} />
            </div>
            <Button type="submit" disabled={busy}>
                {busy && <LoaderCircle className="size-4 animate-spin" />}
                Entrar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEmail(null)}>
                Usar otro correo
            </Button>
        </form>
    );
}
