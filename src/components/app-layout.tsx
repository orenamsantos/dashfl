import { useState } from "react";
import {
  Link,
  Outlet,
  useRouterState,
  useRouter,
  useNavigate,
} from "@tanstack/react-router";
import {
  LayoutDashboard,
  Megaphone,
  ShoppingCart,
  Upload,
  Plug,
  Settings as SettingsIcon,
  Menu,
  RefreshCw,
  X,
  LogOut,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/campaigns", label: "Campanhas", icon: Megaphone },
  { to: "/sales", label: "Vendas", icon: ShoppingCart },
  { to: "/import", label: "Importar CSV", icon: Upload },
  { to: "/integrations", label: "Integrações", icon: Plug },
  { to: "/settings", label: "Configurações", icon: SettingsIcon },
] as const;

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = nav.find((n) => pathname.startsWith(n.to)) ?? nav[0];

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignora — vamos pro login de qualquer jeito
    }
    await router.invalidate();
    navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
              <TrendingUp className="h-4 w-4 text-primary" />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">dashfl</span>
          </div>
          <button
            className="text-sidebar-foreground/70 md:hidden"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className={cn("h-4 w-4", active && "text-primary")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <div className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-semibold text-foreground">
              FL
            </div>
            <span className="truncate">Flavio</span>
            <LogOut className="ml-auto h-4 w-4 opacity-60" />
          </button>
        </div>
      </aside>

      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <button
            className="text-foreground md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="text-sm text-muted-foreground">
            <span>dashfl</span>
            <span className="mx-1.5 opacity-40">/</span>
            <span className="font-medium text-foreground">{current.label}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.invalidate()}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">Atualizar</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
