import { Link, Outlet } from '@shardev/common';
import { ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@{{ app.key }}/components/ui/avatar';
import { Button } from '@{{ app.key }}/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@{{ app.key }}/components/ui/dropdown-menu';
import { useAuth } from '@{{ app.key }}/hooks/auth';
import { ROUTE } from '@{{ app.key }}/routes/paths';

const initials = (name?: string) =>
    (name ?? '')
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || '?';

export default function AppLayout() {
    const { authUser, isAuthenticated, hasPermission, logout } = useAuth();

    return (
        <div className="flex min-h-svh flex-col">
            <header className="flex h-14 items-center gap-4 border-b bg-background px-4 md:px-6">
                <Link to={ROUTE.HOME} className="font-semibold">
                    {{ project.name }} / {{ app.key }}
                </Link>
                {isAuthenticated && (
                    <nav className="flex items-center gap-1 text-sm">
                        <Button asChild variant="ghost" size="sm">
                            <Link to={ROUTE.HOME}>Inicio</Link>
                        </Button>
                        {hasPermission('list', 'roles') && (
                            <Button asChild variant="ghost" size="sm">
                                <Link to={ROUTE.ROLES}>Roles</Link>
                            </Button>
                        )}
                    </nav>
                )}
                <div className="ml-auto">
                    {isAuthenticated ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="gap-2">
                                    <Avatar className="size-6">
                                        <AvatarImage src={authUser.avatar_public_url ?? undefined} alt="" />
                                        <AvatarFallback>{initials(authUser.name)}</AvatarFallback>
                                    </Avatar>
                                    <span className="hidden sm:inline">{authUser.name}</span>
                                    <ChevronDown className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{authUser.email}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem asChild>
                                    <Link to={ROUTE.PROFILE}>
                                        <UserRound className="size-4" /> Perfil
                                    </Link>
                                </DropdownMenuItem>
                                {hasPermission('list', 'roles') && (
                                    <DropdownMenuItem asChild>
                                        <Link to={ROUTE.ROLES}>
                                            <ShieldCheck className="size-4" /> Roles
                                        </Link>
                                    </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onSelect={() => void logout()}>
                                    <LogOut className="size-4" /> Cerrar sesión
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <Button asChild size="sm">
                            <Link to={ROUTE.SIGNIN}>Iniciar sesión</Link>
                        </Button>
                    )}
                </div>
            </header>
            <main className="flex-1 bg-muted/40 p-4 md:p-6">
                <Outlet />
            </main>
        </div>
    );
}
