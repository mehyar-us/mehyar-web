import { Link } from "wouter";
import { useState } from "react";
import ChecklistPopup from "@/components/ChecklistPopup";
import { openSupportTicket } from "@/components/SupportTicketModal";

const Footer = () => {
  const [checklistOpen, setChecklistOpen] = useState(false);
  return (
    <footer className="bg-neutral-900 text-white py-16 px-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="mb-6 inline-flex items-center gap-3" aria-label="MehyarSoft home">
              <span className="grid h-14 w-14 place-items-center rounded-2xl border border-white/15 bg-white p-1.5">
                <img src="/assets/mehyarsoft-mark-new-192.png" alt="" aria-hidden="true" className="h-full w-full object-contain" width="192" height="192" decoding="async" />
              </span>
              <span>
                <span className="block text-2xl font-semibold tracking-[-0.055em]">Mehyar<span className="font-light">Soft</span></span>
                <span className="mt-1 block text-[0.55rem] font-semibold uppercase tracking-[0.28em] text-brand-100">Software • Systems • AI</span>
              </span>
            </Link>
            <p className="text-neutral-300 mb-6">
              Founder-led software, systems, and AI automation for businesses, agencies, and regulated teams worldwide.
            </p>
            <a href="mailto:info@mehyar.us" className="text-neutral-300 hover:text-white transition-colors">
              info@mehyar.us
            </a>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Start here</h4>
            <ul className="space-y-3">
              {[
                ["Find my business", "/pricing"],
                ["Services and pricing", "/services"],
                ["Start a project", "/contact"],
                ["Book a Tech Audit", "/micro-offer#intake"],
                ["OpenClaw and Hermes", "/pricing#industry-pricing"],
              ].map(([item, href]) => (
                <li key={item}>
                  <Link href={href} className="text-neutral-300 hover:text-white transition-colors">{item}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Support</h4>
            <p className="mb-4 text-sm leading-6 text-neutral-300">Need a fix, content update, maintenance, login help, or automation support?</p>
            <button type="button" onClick={openSupportTicket} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 transition hover:bg-brand-100">Create support ticket</button>
            <ul className="mt-5 space-y-3 text-sm text-neutral-300">
              <li>Website and customer app maintenance</li>
              <li>Booking, SMS, email, voice, and AI help</li>
              <li>Support available on every active plan</li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Company</h4>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-neutral-300 hover:text-white transition-colors">About</Link></li>
              <li><Link href="/portfolio" className="text-neutral-300 hover:text-white transition-colors">Engagement Patterns</Link></li>
              <li><Link href="/proposals" className="text-neutral-300 hover:text-white transition-colors">Client growth plans</Link></li>
              <li><Link href="/apps" className="text-neutral-300 hover:text-white transition-colors">Apps we manage</Link></li>
              <li><Link href="/blog" className="text-neutral-300 hover:text-white transition-colors">Insights</Link></li>
              <li><Link href="/contact" className="text-neutral-300 hover:text-white transition-colors">Contact</Link></li>
              <li>
                <button
                  type="button"
                  onClick={() => setChecklistOpen(true)}
                  className="text-left text-neutral-300 hover:text-white transition-colors"
                >
                  Get the free AI checklist →
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center">
          <p className="text-neutral-400">
            © {new Date().getFullYear()} MehyarSoft LLC. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex flex-wrap gap-x-6 gap-y-2 justify-center">
            <Link href="/privacy-policy" className="text-neutral-400 hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-neutral-400 hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/data-deletion" className="text-neutral-400 hover:text-white transition-colors">Data Deletion</Link>
            <Link href="/unsubscribe" className="text-neutral-400 hover:text-white transition-colors">Email settings & unsubscribe</Link>
            <Link href="/sitemap" className="text-neutral-400 hover:text-white transition-colors">Sitemap</Link>
          </div>
        </div>
      </div>

      {/* Popup is mounted at the footer so it inherits the page tree and can
          be opened from any link/button. Persistent across all public pages. */}
      <ChecklistPopup
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        source="footer"
      />
    </footer>
  );
};

export default Footer;
