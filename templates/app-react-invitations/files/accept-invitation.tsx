import { zodResolver } from '@hookform/resolvers/zod';
import { Link, ProcessApiResponse, useData } from '@shardev/common';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import InputError from '@{{ app.key }}/components/input-error';
import { Button } from '@{{ app.key }}/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';
import { ROUTE } from '@{{ app.key }}/routes/paths';

{{#if !app.feature.otp}}
const schema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio').max(255),
    password: z.string().min(10, 'Mínimo 10 caracteres').max(255),
});
{{/if}}
{{#if app.feature.otp}}
const schema = z.object({
    name: z.string().min(1, 'El nombre es obligatorio').max(255),
});
{{/if}}
type Values = z.infer<typeof schema>;

/** El token viaja en el FRAGMENTO (#token=...): no llega al servidor ni a logs/Referer. */
const readToken = (): string => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '';

/**
 * Aceptar una invitación. El token se lee una vez del fragmento de la URL, se quita de la barra de direcciones
 * y vive solo en el estado de este componente (nunca en el store persistido ni en localStorage).
 */
export default function AcceptInvitationPage() {
    const api = useData();
    const [token] = useState(readToken);
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const form = useForm<Values>({ resolver: zodResolver(schema) });

    useEffect(() => {
        if (window.location.hash !== '') {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, []);

    const submit = async (values: Values) => {
        setBusy(true);
        try {
            const r = await api.insert<{ accepted: boolean }, Values & { token: string }>('auth/invitations/accept', { ...values, token });
            if (!r.success) throw new Error(r.message);
            setDone(true);
        } catch (error) {
            form.setError('root.serverError', { type: 'server', message: ProcessApiResponse<unknown>(error).message || 'Invitación inválida o vencida' });
        } finally {
            setBusy(false);
        }
    };

    if (done) {
        return (
            <Card>
                <CardHeader className="text-center">
                    <CardTitle className="text-xl">Cuenta creada</CardTitle>
                    <CardDescription>Ya puedes iniciar sesión.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Button asChild className="w-full">
                        <Link to={ROUTE.SIGNIN}>Iniciar sesión</Link>
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="text-center">
                <CardTitle className="text-xl">Aceptar invitación</CardTitle>
                <CardDescription>{{ project.name }} / {{ app.key }}</CardDescription>
            </CardHeader>
            <CardContent>
                {token === '' ? (
                    <p role="alert" className="text-sm text-destructive">
                        El enlace de la invitación no es válido. Abre el enlace completo del correo.
                    </p>
                ) : (
                    <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
                        <InputError message={form.formState.errors.root?.serverError?.message} />
                        <div className="grid gap-2">
                            <Label htmlFor="name">Nombre</Label>
                            <Input id="name" autoComplete="name" aria-invalid={!!form.formState.errors.name} {...form.register('name')} />
                            <InputError message={form.formState.errors.name?.message} />
                        </div>
{{#if !app.feature.otp}}
                        <div className="grid gap-2">
                            <Label htmlFor="password">Contraseña</Label>
                            <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
                            <InputError message={form.formState.errors.password?.message} />
                        </div>
{{/if}}
                        <Button type="submit" disabled={busy}>
                            {busy && <LoaderCircle className="size-4 animate-spin" />}
                            Crear cuenta
                        </Button>
                    </form>
                )}
            </CardContent>
        </Card>
    );
}
