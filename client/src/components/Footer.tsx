import { Link } from "wouter";

const Footer = () => {
  return (
    <footer className="bg-neutral-900 text-white py-16 px-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div>
            <Link href="/">
              <a className="inline-flex items-center mb-6" aria-label="MehyarSoft home">
                <img
                  src="/assets/mehyarsoft-logo.svg"
                  alt="MehyarSoft"
                  className="h-12 w-auto brightness-0 invert opacity-95"
                  width="280"
                  height="80"
                />
              </a>
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
              {["Tech Audit", "Website / Booking Cleanup", "AI Follow-Up Flow", "Internal Automation Sprint", "Systems Consulting"].map((item) => (
                <li key={item}>
                  <Link href="/services">
                    <a className="text-neutral-300 hover:text-white transition-colors">{item}</a>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Company</h4>
            <ul className="space-y-3">
              <li><Link href="/about"><a className="text-neutral-300 hover:text-white transition-colors">About</a></Link></li>
              <li><Link href="/portfolio"><a className="text-neutral-300 hover:text-white transition-colors">Engagement Patterns</a></Link></li>
              <li><Link href="/blog"><a className="text-neutral-300 hover:text-white transition-colors">Insights</a></Link></li>
              <li><Link href="/contact"><a className="text-neutral-300 hover:text-white transition-colors">Contact</a></Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Responsible contact</h4>
            <p className="text-neutral-300 mb-4">
              No newsletter list is active yet. For consulting requests, use email and avoid sending passwords, API keys, PHI, payment data, or confidential files through public channels.
            </p>
            <Link href="/contact">
              <a className="text-neutral-300 hover:text-white transition-colors">Request a practical next step</a>
            </Link>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center">
          <p className="text-neutral-400">
            © {new Date().getFullYear()} MehyarSoft LLC. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex space-x-6">
            <Link href="/privacy-policy"><a className="text-neutral-400 hover:text-white transition-colors">Privacy Policy</a></Link>
            <Link href="/terms"><a className="text-neutral-400 hover:text-white transition-colors">Terms of Service</a></Link>
            <Link href="/unsubscribe"><a className="text-neutral-400 hover:text-white transition-colors">Unsubscribe</a></Link>
            <Link href="/sitemap"><a className="text-neutral-400 hover:text-white transition-colors">Sitemap</a></Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
