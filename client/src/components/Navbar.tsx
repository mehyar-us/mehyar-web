import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  AppWindow,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Home,
  Info,
  LifeBuoy,
  Mail,
  Menu,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import ThemeToggle from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import { openSupportTicket } from "@/components/SupportTicketModal";

const primaryLinks = [
  { href: "/pricing#industry-pricing", label: "Businesses", icon: Building2 },
  { href: "/services", label: "Services", icon: AppWindow },
  { href: "/pricing", label: "Pricing", icon: Tags },
  { href: "/portfolio", label: "Work", icon: BriefcaseBusiness },
  { href: "/blog", label: "Insights", icon: BookOpen },
  { href: "/about", label: "About", icon: Info },
];

const actionLinks = [
  { href: "/contact", label: "Start a project", icon: Mail },
  { href: "/booking", label: "Book a call", icon: CalendarDays },
  { href: "/micro-offer#intake", label: "Book a tech audit", icon: ClipboardCheck },
];

const accountLinks = [
  { href: "/unsubscribe", label: "Email settings & unsubscribe", icon: Settings2 },
  { href: "/privacy-policy", label: "Privacy", icon: ShieldCheck },
  { href: "/terms", label: "Terms", icon: FileText },
  { href: "/data-deletion", label: "Data deletion", icon: Trash2 },
];

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setIsMobileMenuOpen(false), [location]);

  useEffect(() => {
    document.body.style.overflow = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <nav
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-border/80 backdrop-blur-xl transition-[background,border-color] duration-200",
        isScrolled
          ? "bg-white/[0.96] dark:bg-brand-950/[0.96]"
          : "bg-white/[0.9] dark:bg-brand-950/[0.9]",
      )}
      aria-label="Main navigation"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-[4.5rem] items-center justify-between gap-5">
          <Link
            href="/"
            className="group flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-3"
            aria-label="MehyarSoft home"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-brand-700/15 bg-white p-1.5 shadow-[0_10px_26px_rgba(8,63,84,0.16)] dark:bg-brand-950 sm:h-12 sm:w-12">
              <img
                src="/assets/mehyarsoft-mark-new-192.png"
                alt=""
                aria-hidden="true"
                className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
                width="192"
                height="192"
                decoding="async"
              />
            </span>
            <span className="flex min-w-0 flex-col leading-none">
              <span className="text-[1.55rem] font-semibold tracking-[-0.065em] text-brand-950 dark:text-white sm:text-[1.8rem]">
                Mehyar<span className="font-light">Soft</span>
              </span>
              <span className="mt-1 hidden text-[0.55rem] font-semibold uppercase tracking-[0.29em] text-brand-800/72 dark:text-brand-100/78 sm:block">
                Software • Systems • AI
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 rounded-full border border-border/80 bg-white/72 p-1.5 shadow-sm backdrop-blur min-[1180px]:flex dark:bg-zinc-900/72">
            {primaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-full px-2.5 py-2 text-sm font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  location === link.href.split("#")[0]
                    ? "bg-brand-100 text-brand-900 dark:bg-white/10 dark:text-white"
                    : "text-ink/75 hover:text-brand-800 dark:text-white/72 dark:hover:text-white",
                )}
              >
                {link.label}
              </Link>
            ))}
            <button type="button" onClick={openSupportTicket} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full px-3")}>
              <LifeBuoy className="mr-1.5 h-4 w-4" />Support
            </button>
            <Link href="/contact" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "rounded-full px-4")}>Start</Link>
            <ThemeToggle />
          </div>

          <div className="flex items-center gap-1.5 min-[1180px]:hidden">
            <button
              type="button"
              onClick={openSupportTicket}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-semibold text-brand-900 shadow-sm dark:text-white sm:hidden"
            >
              <LifeBuoy className="h-4 w-4" />Help
            </button>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              aria-label={isMobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={isMobileMenuOpen}
              aria-controls="mobile-site-menu"
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </Button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div id="mobile-site-menu" className="fixed inset-x-0 bottom-0 top-[4.5rem] overflow-y-auto border-t border-border bg-background/98 px-4 pb-28 pt-4 backdrop-blur-xl min-[1180px]:hidden">
          <div className="mx-auto max-w-xl space-y-5">
            <div className="grid grid-cols-2 gap-2">
              {primaryLinks.map((link) => {
                const Icon = link.icon;
                const active = location === link.href.split("#")[0];
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-2xl border px-3 py-3 text-sm font-semibold transition-colors",
                      active
                        ? "border-brand-700/25 bg-brand-100 text-brand-950 dark:bg-brand-800 dark:text-white"
                        : "border-border bg-card text-foreground hover:border-brand-700/25 hover:bg-brand-100/70 dark:hover:bg-brand-900",
                    )}
                    onClick={closeMenu}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-100" />
                    {link.label}
                  </Link>
                );
              })}
            </div>

            <section aria-labelledby="mobile-start-heading">
              <h2 id="mobile-start-heading" className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Start or get help</h2>
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                {actionLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link key={link.href} href={link.href} onClick={closeMenu} className="flex min-h-12 items-center gap-3 border-b border-border px-4 py-3 text-sm font-medium last:border-b-0 hover:bg-brand-100/60 dark:hover:bg-brand-900">
                      <Icon className="h-[1.125rem] w-[1.125rem] text-brand-700 dark:text-brand-100" />{link.label}
                    </Link>
                  );
                })}
                <button type="button" onClick={() => { closeMenu(); openSupportTicket(); }} className="flex min-h-12 w-full items-center gap-3 border-t border-border px-4 py-3 text-left text-sm font-semibold text-brand-800 hover:bg-brand-100/60 dark:text-brand-100 dark:hover:bg-brand-900">
                  <LifeBuoy className="h-[1.125rem] w-[1.125rem]" />Create a support ticket
                </button>
              </div>
            </section>

            <section aria-labelledby="mobile-settings-heading">
              <h2 id="mobile-settings-heading" className="mb-2 px-1 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">Settings & privacy</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {accountLinks.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link key={link.href} href={link.href} onClick={closeMenu} className="flex min-h-12 items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-sm font-medium hover:bg-brand-100/60 dark:hover:bg-brand-900">
                      <Icon className="h-[1.125rem] w-[1.125rem] text-brand-700 dark:text-brand-100" />{link.label}
                    </Link>
                  );
                })}
              </div>
            </section>

            <Link href="/" onClick={closeMenu} className="flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              <Home className="h-4 w-4" />Back to home
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
