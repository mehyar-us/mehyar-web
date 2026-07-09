import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import ThemeToggle from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/services", label: "Services" },
    { href: "/portfolio", label: "Portfolio" },
    { href: "/about", label: "About" },
    { href: "/blog", label: "Blog" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <nav
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-border/80 backdrop-blur-xl transition-[background,border-color] duration-200",
        isScrolled
          ? "bg-white/[0.94] dark:bg-brand-950/[0.94]"
          : "bg-white/[0.88] dark:bg-brand-950/[0.88]"
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-[4.5rem] items-center justify-between gap-6">
          <Link
            href="/"
            className="group flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:gap-3"
            aria-label="MehyarSoft home"
          >
            <img
              src="/assets/mehyarsoft-mark.png"
              alt=""
              aria-hidden="true"
              className="h-11 w-11 shrink-0 rounded-xl object-contain shadow-[0_10px_26px_rgba(8,63,84,0.18)] transition-transform duration-200 group-hover:scale-[1.02] sm:h-12 sm:w-12 lg:h-[3.35rem] lg:w-[3.35rem]"
              width="1024"
              height="1024"
              decoding="async"
            />
            <span className="flex min-w-0 flex-col leading-none">
              <span className="text-[1.58rem] font-semibold tracking-[-0.08em] text-brand-950 dark:text-white sm:text-[1.82rem] lg:text-[2.05rem]">
                Mehyar<span className="font-light tracking-[-0.095em]">Soft</span>
              </span>
              <span className="mt-1 hidden text-[0.56rem] font-semibold uppercase tracking-[0.32em] text-brand-800/72 dark:text-brand-100/78 sm:block lg:text-[0.62rem]">
                Software • Systems • AI
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-2 rounded-full border border-border/80 bg-white/62 p-1.5 shadow-[0_1px_2px_rgba(10,20,24,0.04)] backdrop-blur xl:flex dark:bg-white/[0.04]">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "relative rounded-full px-2.5 py-2 text-sm font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
                  location === link.href
                    ? "bg-brand-100 text-brand-900 dark:bg-white/10 dark:text-white"
                    : "text-ink/75 hover:text-brand-800 dark:text-white/72 dark:hover:text-white"
                )}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/micro-offer#intake" className={cn(buttonVariants({ variant: "cta", size: "sm" }), "hidden rounded-full px-4 lg:inline-flex")}>
              Book a Tech Audit
            </Link>
            <ThemeToggle />
          </div>

          <div className="flex items-center gap-2 xl:hidden">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle menu"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </Button>
          </div>
        </div>

        {isMobileMenuOpen && (
          <div className="xl:hidden border-t border-border py-4">
            <div className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    location === link.href
                      ? "bg-brand-100 text-brand-900 dark:bg-brand-800 dark:text-white"
                      : "text-ink/78 hover:bg-brand-100 hover:text-brand-900 dark:text-white/78 dark:hover:bg-brand-900 dark:hover:text-white"
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/micro-offer#intake"
                className={cn(buttonVariants({ variant: "cta" }), "mt-2 w-full")}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Book a Tech Audit
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
