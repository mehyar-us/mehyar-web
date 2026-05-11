import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        "fixed inset-x-0 top-0 z-50 border-b border-border backdrop-blur-xl transition-[background,border-color] duration-200",
        isScrolled
          ? "bg-white/94 dark:bg-brand-950/94"
          : "bg-white/88 dark:bg-brand-950/88"
      )}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-6">
          <Link href="/">
            <a
              className="flex min-h-11 items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="MehyarSoft home"
            >
              <img
                src="/assets/mehyarsoft-logo.svg"
                alt="MehyarSoft"
                className="h-9 w-auto dark:hidden sm:h-10"
                width="280"
                height="80"
              />
              <img
                src="/assets/mehyarsoft-logo-dark.svg"
                alt="MehyarSoft"
                className="hidden h-9 w-auto dark:block sm:h-10"
                width="280"
                height="80"
              />
            </a>
          </Link>

          <div className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <a
                  className={cn(
                    "relative rounded-sm text-sm font-medium tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background",
                    location === link.href
                      ? "text-brand-800 after:absolute after:-bottom-2 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-brand-700 dark:text-white dark:after:bg-brand-100"
                      : "text-ink/75 hover:text-brand-800 dark:text-white/72 dark:hover:text-white"
                  )}
                >
                  {link.label}
                </a>
              </Link>
            ))}
            <Link href="/contact">
              <Button variant="cta" size="sm" className="hidden lg:inline-flex">
                Book Audit
              </Button>
            </Link>
            <ThemeToggle />
          </div>

          <div className="flex items-center gap-2 md:hidden">
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
          <div className="md:hidden border-t border-border py-4">
            <div className="flex flex-col gap-2">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href}>
                  <a
                    className={cn(
                      "rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      location === link.href
                        ? "bg-brand-100 text-brand-900 dark:bg-brand-800 dark:text-white"
                        : "text-ink/78 hover:bg-brand-100 hover:text-brand-900 dark:text-white/78 dark:hover:bg-brand-900 dark:hover:text-white"
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                </Link>
              ))}
              <Link href="/contact">
                <Button
                  variant="cta"
                  className="mt-2 w-full"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Book a Tech Audit
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
