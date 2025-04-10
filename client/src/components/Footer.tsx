import { Link } from "wouter";
import { Github, Linkedin, Twitter, Facebook } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const Footer = () => {
  const [email, setEmail] = useState("");
  const { toast } = useToast();

  const handleSubscribe = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Subscribed!",
      description: "You've been added to our newsletter list.",
    });
    setEmail("");
  };

  return (
    <footer className="bg-neutral-900 text-white py-16 px-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          <div>
            <h3 className="text-2xl font-bold mb-6">MehyarSoft</h3>
            <p className="text-neutral-300 mb-6">
              Custom web applications, CRM systems, and automation solutions that
              drive business growth.
            </p>
            <div className="flex space-x-4">
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors"
                aria-label="LinkedIn"
              >
                <Linkedin size={18} />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors"
                aria-label="Twitter"
              >
                <Twitter size={18} />
              </a>
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors"
                aria-label="Facebook"
              >
                <Facebook size={18} />
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 bg-neutral-800 hover:bg-primary rounded-full flex items-center justify-center transition-colors"
                aria-label="GitHub"
              >
                <Github size={18} />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Services</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/services">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Web Application Development
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/services">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    CRM Systems
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/services">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Automation Solutions
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/services">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    UI/UX Design
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/services">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Technology Consulting
                  </a>
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Company</h4>
            <ul className="space-y-3">
              <li>
                <Link href="/about">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    About Us
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/portfolio">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Portfolio
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/blog">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Blog
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/contact">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Careers
                  </a>
                </Link>
              </li>
              <li>
                <Link href="/contact">
                  <a className="text-neutral-300 hover:text-white transition-colors">
                    Contact Us
                  </a>
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-6">Newsletter</h4>
            <p className="text-neutral-300 mb-4">
              Subscribe to our newsletter for the latest updates and insights.
            </p>
            <form className="space-y-3" onSubmit={handleSubscribe}>
              <Input
                type="email"
                placeholder="Your email address"
                className="w-full px-4 py-2 rounded-lg border border-neutral-700 bg-neutral-800 text-white focus:outline-none focus:ring-2 focus:ring-primary"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button
                type="submit"
                className="w-full px-4 py-2 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors"
              >
                Subscribe
              </Button>
            </form>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-neutral-800 flex flex-col md:flex-row justify-between items-center">
          <p className="text-neutral-400">
            © {new Date().getFullYear()} MehyarSoft. All rights reserved.
          </p>
          <div className="mt-4 md:mt-0 flex space-x-6">
            <Link href="/privacy-policy">
              <a className="text-neutral-400 hover:text-white transition-colors">
                Privacy Policy
              </a>
            </Link>
            <Link href="/terms">
              <a className="text-neutral-400 hover:text-white transition-colors">
                Terms of Service
              </a>
            </Link>
            <Link href="/sitemap">
              <a className="text-neutral-400 hover:text-white transition-colors">
                Sitemap
              </a>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
