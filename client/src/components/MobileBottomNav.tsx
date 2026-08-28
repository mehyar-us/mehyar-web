import { Building2, Home, Layers3, MessageCircle, PanelsTopLeft } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", icon: Home, active: (path: string) => path === "/" },
  { href: "/services", label: "Solutions", icon: Layers3, active: (path: string) => path === "/services" },
  { href: "/pricing", label: "Industries", icon: Building2, active: (path: string) => path === "/pricing" || path.startsWith("/industries/") },
  { href: "/portfolio", label: "Work", icon: PanelsTopLeft, active: (path: string) => path === "/portfolio" || path.startsWith("/portfolio/") },
  { href: "/contact", label: "Contact", icon: MessageCircle, active: (path: string) => path === "/contact" || path === "/booking" },
];

export default function MobileBottomNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/96 shadow-[0_-8px_30px_rgba(6,47,66,0.08)] backdrop-blur-xl min-[1180px]:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid h-16 max-w-xl grid-cols-5">
        {links.map((link) => {
          const Icon = link.icon;
          const active = link.active(location);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[0.61rem] font-semibold transition-colors sm:text-[0.68rem]",
                active
                  ? "text-brand-800 dark:text-brand-100"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" /><span className="max-w-full truncate">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
