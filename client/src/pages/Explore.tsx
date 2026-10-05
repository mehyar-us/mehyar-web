import VisualExplorer from "@/components/VisualExplorer";
import { Link, useSearch } from "wouter";
import { useEffect } from "react";
import { useExplorer } from "@/components/MayorStore";
export default function Explore() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const industry = params.get("industry")?.slice(0, 100);
  const topic = params.get("topic")?.slice(0, 1000);
  const mayor = useExplorer();
  useEffect(()=>{mayor.launch(topic||"",industry||"");},[topic,industry]);
  return (
    <section className="site-hero px-4">
      <div className="site-shell explore-page">
        <div className="explore-page-intro">
          <p className="site-eyebrow">The Mayor · by MehyarSoft</p>
          <h1 className="site-display">
            Ask The Mayor.
            <br />Think visually.
          </h1>
          <p className="site-lede">
            Ask free questions, explore an idea visually and find the right solution. Sign in to your private workspace when you’re ready to use configured business AI and automations.
          </p>
          <Link href="/industries">Browse business examples instead →</Link>
          <a className="inline-flex min-h-11 items-center mt-3 underline" href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">Private Mayor sign-in ↗</a>
        </div>
        <VisualExplorer
          industry={industry || undefined}
          topic={topic || undefined}
        />
      </div>
    </section>
  );
}
