import { Link } from '@shardev/common';
import { Button } from '@{{ app.key }}/components/ui/button';
import { ROUTE } from '@{{ app.key }}/routes/paths';

export default function NotFoundPage() {
    return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
            <p className="text-6xl font-bold">404</p>
            <p className="text-muted-foreground">La página que buscas no existe.</p>
            <Button asChild>
                <Link to={ROUTE.HOME}>Volver al inicio</Link>
            </Button>
        </div>
    );
}
