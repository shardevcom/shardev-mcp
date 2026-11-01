{{#if !app.feature.otp}}
import { zodResolver } from '@hookform/resolvers/zod';
import { LoaderCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
{{/if}}
{{#if !app.feature.otp}}
import InputError from '@{{ app.key }}/components/input-error';
{{/if}}
{{#if !app.feature.otp}}
import { Button } from '@{{ app.key }}/components/ui/button';
{{/if}}
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
{{#if !app.feature.otp}}
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';
import { useAuth } from '@{{ app.key }}/hooks/auth';
{{/if}}
{{#if app.feature.otp}}
import OtpForm from '@{{ app.key }}/pages/auth/sign-in/otp-form';
{{/if}}
{{#if app.feature.social}}
import SocialButtons from '@{{ app.key }}/pages/auth/sign-in/social-buttons';
{{/if}}

{{#if !app.feature.otp}}
const schema = z.object({
    email: z.string().min(1, 'El correo es obligatorio').email('Correo inválido'),
    password: z.string().min(1, 'La contraseña es obligatoria'),
});
type Values = z.infer<typeof schema>;

export default function SignIn() {
    const { login, loading } = useAuth();
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors },
    } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

    const onSubmit = async (values: Values) => {
        try {
            await login(values.email, values.password);
        } catch (error) {
            setError('root.serverError', { type: 'server', message: error instanceof Error ? error.message : 'No se pudo iniciar sesión' });
        }
    };

    return (
        <Card>
            <CardHeader className="text-center">
                <CardTitle className="text-xl">Iniciar sesión</CardTitle>
                <CardDescription>{{ project.name }} / {{ app.key }}</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4" noValidate>
                    <InputError message={errors.root?.serverError?.message} />
                    <div className="grid gap-2">
                        <Label htmlFor="email">Correo</Label>
                        <Input id="email" type="email" autoComplete="username" aria-invalid={!!errors.email} {...register('email')} />
                        <InputError message={errors.email?.message} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="password">Contraseña</Label>
                        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register('password')} />
                        <InputError message={errors.password?.message} />
                    </div>
                    <Button type="submit" disabled={loading}>
                        {loading && <LoaderCircle className="size-4 animate-spin" />}
                        Entrar
                    </Button>
                </form>
{{#if app.feature.social}}
                <div className="mt-4"><SocialButtons /></div>
{{/if}}
            </CardContent>
        </Card>
    );
}
{{/if}}
{{#if app.feature.otp}}
export default function SignIn() {
    return (
        <Card>
            <CardHeader className="text-center">
                <CardTitle className="text-xl">Iniciar sesión</CardTitle>
                <CardDescription>{{ project.name }} / {{ app.key }}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
                <OtpForm />
{{#if app.feature.social}}
                <SocialButtons />
{{/if}}
            </CardContent>
        </Card>
    );
}
{{/if}}
