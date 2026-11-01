import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@{{ app.key }}/components/ui/card';
import { useAuth } from '@{{ app.key }}/hooks/auth';

export default function HomePage() {
    const { authUser } = useAuth();

    return (
        <Card className="mx-auto max-w-2xl">
            <CardHeader>
                <CardTitle>Hola, {authUser.name}</CardTitle>
                <CardDescription>Sesión iniciada en la app {{ app.key }}.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">Este es el punto de partida de la app: añade tus páginas en src/pages y regístralas en src/routes.</CardContent>
        </Card>
    );
}
