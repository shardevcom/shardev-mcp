import { useAppDispatch, useData } from '@shardev/common';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@{{ app.key }}/components/ui/badge';
import { Button } from '@{{ app.key }}/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';
import { useAuth } from '@{{ app.key }}/hooks/auth';
import { setAuth } from '@{{ app.key }}/reducers/slices/authSlice';
import type { UserAuth } from '@{{ app.key }}/types';

/** Perfil de la cuenta autenticada: el backend lo resuelve del token, nunca de un id enviado desde aquí. */
export default function ProfilePage() {
    const dispatch = useAppDispatch();
    const api = useData();
    const { authUser } = useAuth();
    const [name, setName] = useState(authUser.name ?? '');
    const [saving, setSaving] = useState(false);
{{#if !app.feature.otp}}
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
{{/if}}

    useEffect(() => {
        void api.fetch<UserAuth>('profile').then((r) => {
            if (r.success && r.data) {
                dispatch(setAuth(r.data));
                setName(r.data.name ?? '');
            }
        });
    }, [api, dispatch]);

    const saveProfile = async () => {
        setSaving(true);
        try {
            const r = await api.modify<UserAuth, { name: string }>('profile', {}, { name });
            if (!r.success) throw new Error(r.message);
            if (r.data) dispatch(setAuth(r.data));
            toast.success('Perfil actualizado');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'No se pudo guardar');
        } finally {
            setSaving(false);
        }
    };

{{#if !app.feature.otp}}
    const changePassword = async () => {
        setSaving(true);
        try {
            const r = await api.insert<UserAuth, { current_password: string; new_password: string }>('auth/change-password', {
                current_password: current,
                new_password: next,
            });
            if (!r.success) throw new Error(r.message);
            setCurrent('');
            setNext('');
            toast.success('Contraseña actualizada; las demás sesiones se cerraron');
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'No se pudo cambiar la contraseña');
        } finally {
            setSaving(false);
        }
    };
{{/if}}

    return (
        <div className="mx-auto grid w-full max-w-2xl gap-6">
            <Card>
                <CardHeader>
                    <CardTitle>Perfil</CardTitle>
                    <CardDescription>
                        {authUser.email} {authUser.roles?.map((r) => <Badge key={String(r.id)} variant="secondary">{r.name}</Badge>)}
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Nombre</Label>
                        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                    </div>
                    <Button className="w-fit" onClick={saveProfile} disabled={saving || name.trim() === ''}>
                        Guardar
                    </Button>
                </CardContent>
            </Card>
{{#if !app.feature.otp}}
            <Card>
                <CardHeader>
                    <CardTitle>Cambiar contraseña</CardTitle>
                    <CardDescription>Mínimo 10 caracteres. Se cierran tus otras sesiones.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="current">Contraseña actual</Label>
                        <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="next">Nueva contraseña</Label>
                        <Input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                    </div>
                    <Button className="w-fit" onClick={changePassword} disabled={saving || current === '' || next.length < 10}>
                        Cambiar contraseña
                    </Button>
                </CardContent>
            </Card>
{{/if}}
        </div>
    );
}
