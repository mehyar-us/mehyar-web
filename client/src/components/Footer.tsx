import { Link } from "wouter";

const Footer = () => {
  return (
    <footer className="bg-neutral-900 text-white py-16 px-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div>
            <Link href="/" className="inline-flex items-center mb-6" aria-label="MehyarSoft home">
                <img
                  src="/assets/mehyarsoft-logo-dark.svg"
                  alt="MehyarSoft"
                  className="h-14 w-auto opacity-95"
                  width="760"
                  height="180"
                  decoding="async"
                />
            </Link>
            <p className="text-neutral-300 mb-6">
              Founder-led software, systems, and AI automation consulting for local businesses, agencies, and regulated teams.
            </p>
            <a href="mailto:info@mehyar.us" className="text-neutral-300 hover:text-white transition-colors">
              info@mehyar.us
            </a>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Offers</h4>
            <ul className="space-y-3">
              {[
                ["Tech Audit", "/services"],
                ["Website / Booking Cleanup", "/services"],
                ["AI Follow-Up Flow", "/services"],
                ["Internal Automation Sprint", "/services"],
                ["Systems Consulting", "/services"],
              ].map(([item, href]) => (
                <li key={item}>
                  <Link href={href} className="text-neutral-300 hover:text-white transition-colors">{item}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Company</h4>
            <ul className="space-y-3">
              <li><Link href="/about" className="text-neutral-300 hover:text-white transition-colors">About</Link></li>
              <li><Link href="/portfolio" className="text-neutral-300 hover:text-white transition-colors">Engagement Patterns</Link></li>
              <li><Link href="/blog" className="text-neutral-300 hover:text-white transition-colors">Insights</Link></li>
              <li><Link href="/contact" className="text-neutral-300 hover:text-white transition-colors">Contact</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Responsible contact</h4>
            <p className="text-neutral-300 mb-4">
              No newsletter list is active yet. For consulting requests, use email and avoid sending passwords, API keys, PHI, payment data, or confidential files through public channels.
            </p>
            <Link href="/contact" className="text-neutral-300 hover:text-white transition-colors">Request a practical next step</Link>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center">
          <p className="text-neutral-400">
            © {new Date().getFullYear()} MehyarSoft LLC. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex space-x-6">
            <Link href="/privacy-policy" className="text-neutral-400 hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="text-neutral-400 hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/unsubscribe" className="text-neutral-400 hover:text-white transition-colors">Unsubscribe</Link>
            <Link href="/sitemap" className="text-neutral-400 hover:text-white transition-colors">Sitemap</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
