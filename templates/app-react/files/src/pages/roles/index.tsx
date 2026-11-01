import { useResourceService } from '@shardev/common';
import { Badge } from '@{{ app.key }}/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@{{ app.key }}/components/ui/table';
import type { Role } from '@{{ app.key }}/types';

/** Roles del proyecto. La API exige el permiso `list:roles`; sin él responde 403 aunque se llegue aquí. */
export default function RolesPage() {
    const { items, isLoading, error } = useResourceService<Role>('roles', {
        perPage: 25,
        autoFetch: true,
        include: ['permissions'],
    });

    return (
        <Card className="mx-auto w-full max-w-4xl">
            <CardHeader>
                <CardTitle>Roles</CardTitle>
                <CardDescription>Roles de acceso y el guard al que pertenece cada uno.</CardDescription>
            </CardHeader>
            <CardContent>
                {error ? (
                    <p role="alert" className="text-sm text-destructive">
                        No se pudieron cargar los roles.
                    </p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nombre</TableHead>
                                <TableHead>Guard</TableHead>
                                <TableHead>Permisos</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && (
                                <TableRow>
                                    <TableCell colSpan={3}>Cargando…</TableCell>
                                </TableRow>
                            )}
                            {items.map((role) => (
                                <TableRow key={String(role.id)}>
                                    <TableCell className="font-medium">{role.name}</TableCell>
                                    <TableCell>
                                        <Badge variant="outline">{role.guard_name}</Badge>
                                    </TableCell>
                                    <TableCell>{role.permissions?.length ?? 0}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}
