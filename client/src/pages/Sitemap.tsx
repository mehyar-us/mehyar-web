import { useEffect } from "react";
import { Link } from "wouter";

const Sitemap = () => {
  useEffect(() => {
    document.title = "Sitemap | MehyarSoft";
  }, []);

  const links = [
    ["Home", "/"],
    ["Services", "/services"],
    ["Portfolio", "/portfolio"],
    ["About", "/about"],
    ["Blog", "/blog"],
    ["Contact", "/contact"],
    ["Privacy Policy", "/privacy-policy"],
    ["Terms of Service", "/terms"],
  ];

  return (
    <section className="pt-28 pb-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto max-w-3xl">
        <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">Sitemap</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {links.map(([label, href]) => (
            <Link key={href} href={href}>
              <a className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-4 text-neutral-800 dark:text-neutral-200 hover:text-primary transition-colors">
                {label}
              </a>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Sitemap;
