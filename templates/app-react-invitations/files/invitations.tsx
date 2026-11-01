import { useData } from '@shardev/common';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@{{ app.key }}/components/ui/badge';
import { Button } from '@{{ app.key }}/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { Input } from '@{{ app.key }}/components/ui/input';
import { Label } from '@{{ app.key }}/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@{{ app.key }}/components/ui/table';
import { useAuth } from '@{{ app.key }}/hooks/auth';

interface Invitation {
    id: number;
    email: string;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expires_at: string | null;
    created_at: string | null;
}

/**
 * Invitaciones de esta app. Mostrar u ocultar botones es solo comodidad: el servidor exige el permiso
 * `<acción>:invitations` en cada petición. Las invitaciones no asignan roles: el rol se asigna después.
 */
export default function InvitationsPage() {
    const api = useData();
    const { hasPermission } = useAuth();
    const [items, setItems] = useState<Invitation[]>([]);
    const [email, setEmail] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = await api.fetch<Invitation[]>('invitations');
        if (r.success && Array.isArray(r.data)) setItems(r.data);
    }, [api]);

    useEffect(() => {
        void load();
    }, [load]);

    const invite = async () => {
        setBusy(true);
        try {
            const r = await api.insert<unknown, { email: string }>('invitations', { email: email.trim() });
            if (!r.success) throw new Error(r.message);
            setEmail('');
            // La respuesta es la misma exista o no una cuenta con ese correo.
            toast.success('Si el correo no tiene cuenta, se envió la invitación');
            await load();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : 'No se pudo invitar');
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (id: number) => {
        setBusy(true);
        try {
            const r = await api.remove<unknown>('invitations', { id });
            if (!r.success) throw new Error(r.message);
            await load();
        } catch (e) {
            toast.error(e instanceof Error && e.message ? e.message : 'No se pudo revocar');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="mx-auto grid w-full max-w-4xl gap-6">
            {hasPermission('create', 'invitations') && (
                <Card>
                    <CardHeader>
                        <CardTitle>Invitar</CardTitle>
                        <CardDescription>La invitación vale 7 días y se usa una sola vez. La cuenta nace sin roles.</CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-end gap-2">
                        <div className="grid flex-1 gap-2">
                            <Label htmlFor="invite-email">Correo</Label>
                            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>
                        <Button onClick={invite} disabled={busy || email.trim() === ''}>
                            Enviar invitación
                        </Button>
                    </CardContent>
                </Card>
            )}
            <Card>
                <CardHeader>
                    <CardTitle>Invitaciones</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Correo</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead>Vence</TableHead>
                                <TableHead />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {items.map((i) => (
                                <TableRow key={i.id}>
                                    <TableCell className="font-medium">{i.email}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{i.status}</Badge>
                                    </TableCell>
                                    <TableCell>{i.expires_at ? new Date(i.expires_at).toLocaleDateString() : ''}</TableCell>
                                    <TableCell>
                                        {i.status === 'pending' && hasPermission('remove', 'invitations') && (
                                            <Button variant="ghost" size="sm" onClick={() => void revoke(i.id)} disabled={busy}>
                                                Revocar
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
