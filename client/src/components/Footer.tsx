import { Link } from "wouter";
import { openSupportTicket } from "@/components/SupportTicketModal";
export default function Footer() {
  return (
    <footer className="border-t border-border px-4 py-10">
      <div className="site-shell">
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          <div>
            <Link href="/" className="text-xl font-semibold">
              MehyarSoft
            </Link>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              Custom AI built around your business. Founder-led engineering and
              support.
            </p>
            <a
              href="mailto:info@mehyar.us"
              className="mt-3 inline-flex min-h-11 text-sm underline"
            >
              info@mehyar.us
            </a>
          </div>
          <nav
            aria-label="Footer navigation"
            className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm"
          >
            {[
              ["Ask The Mayor", "/explore"],
              ["The Mayor · business AI", "/mayor"],
              ["About Mehyar", "/about"],
              ["Pricing", "/pricing"],
              ["Insights", "/blog"],
              ["Enterprise", "/enterprise"],
              ["Products & labs", "/apps"],
              ["Free checklist", "/free-checklist"],
              ["Website audit", "/audit"],
              ["Founder-led audit", "/micro-offer"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className="inline-flex min-h-11 items-center hover:underline"
              >
                {label}
              </Link>
            ))}
            <a href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center hover:underline">Private Mayor sign-in ↗</a>
            <button
              type="button"
              onClick={openSupportTicket}
              className="min-h-11 text-left hover:underline"
            >
              Support
            </button>
            <Link
              href="/contact"
              className="inline-flex min-h-11 items-center font-semibold"
            >
              Discuss your business
            </Link>
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} MehyarSoft LLC</span>
          {[
            ["Privacy", "/privacy-policy"],
            ["Terms", "/terms"],
            ["Data deletion", "/data-deletion"],
            ["Email settings", "/unsubscribe"],
            ["Sitemap", "/sitemap"],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-11 items-center hover:underline"
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
