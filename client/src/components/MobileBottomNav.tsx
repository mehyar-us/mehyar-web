import { Building2, Home, LifeBuoy, Tags } from "lucide-react";
import { Link, useLocation } from "wouter";
import { openSupportTicket } from "@/components/SupportTicketModal";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Home", icon: Home },
  { href: "/pricing#industry-pricing", label: "Businesses", icon: Building2 },
  { href: "/pricing", label: "Pricing", icon: Tags },
];

export default function MobileBottomNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/96 shadow-[0_-8px_30px_rgba(6,47,66,0.08)] backdrop-blur-xl min-[1180px]:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto grid h-16 max-w-xl grid-cols-4">
        {links.map((link) => {
          const Icon = link.icon;
          const active = location === link.href.split("#")[0];
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[0.68rem] font-semibold transition-colors",
                active
                  ? "text-brand-800 dark:text-brand-100"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" />{link.label}
            </Link>
          );
        })}
        <button type="button" onClick={openSupportTicket} className="flex flex-col items-center justify-center gap-1 text-[0.68rem] font-semibold text-muted-foreground transition-colors hover:text-brand-800 dark:hover:text-brand-100">
          <LifeBuoy className="h-5 w-5" />Support
        </button>
      </div>
    </nav>
  );
}
