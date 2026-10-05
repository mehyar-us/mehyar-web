import MayorPlans from "@/components/MayorPlans";
import MayorPwaShowcase from "@/components/MayorPwaShowcase";
import { blogPosts } from "@/data/blog-posts";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import VisualExplorer from "@/components/VisualExplorer";
import { useExplorer } from "@/components/MayorStore";
import HomeProductPreview from "@/components/HomeProductPreview";
import { industryOffers } from "@/data/industry-offers";
export default function Home() {
  const mayor=useExplorer();
  return (
    <>
      <section className="studio-hero px-4">
        <div className="site-shell studio-hero-grid">
          <div className="studio-intro">
            <div className="mayor-hero-identity">
              <img src="/assets/mayor-avatar.webp" alt="The Mayor, your AI business companion" width="112" height="112" />
              <p className="site-eyebrow">Your AI business companion</p>
            </div>
            <h1 className="site-display">
              Meet The Mayor.
              <br />
              <em>See what’s next.</em>
            </h1>
            <p className="site-lede">
              Talk through a business question. See a workflow, compare options or plan your next step—with visuals that make it easier to understand.
            </p>
            <div className="studio-human">
              <button onClick={()=>mayor.launch()}>Ask The Mayor free <ArrowRight size={17} /></button>
              <a href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">Sign in to The Mayor <ArrowRight size={16}/></a>
            </div>
            <p className="mayor-hero-workspace">In your private workspace: manage customers, tasks and appointments with AI built around your business.</p>
            <figure className="studio-hero-photo">
              <img
                src="/assets/industries-v2/barbershops-salons.webp"
                alt="A barber working with a customer; illustrative business setting"
                width="800"
                height="600"
                loading="eager"
              />
              <figcaption>
                Built around real work, not a technology checklist.
              </figcaption>
            </figure>
          </div>
          <VisualExplorer compact />
        </div>
      </section>
      <MayorPlans showAddOns={false}/>
      <section className="studio-industries px-4">
        <div className="site-shell">
          <div className="studio-section-heading">
            <div>
              <p className="site-eyebrow">Find your starting point</p>
              <h2>Your business has its own rhythm.</h2>
            </div>
            <Link href="/industries">
              Explore all industries <ArrowRight size={18} />
            </Link>
          </div>
          <div className="studio-image-grid">
            {[industryOffers[0], industryOffers[5], industryOffers[3]].map(
              (industry) => (
                <Link
                  href={`/industries/${industry.id}`}
                  key={industry.id}
                  className="studio-image-link"
                >
                  <img
                    src={industry.heroImage}
                    alt={`${industry.shortName} illustrative business setting`}
                    width="800"
                    height="600"
                    loading="lazy"
                  />
                  <span>
                    <strong>{industry.shortName}</strong>
                    <small>{industry.outcomes[0]}</small>
                    <ArrowRight size={20} />
                  </span>
                </Link>
              ),
            )}
          </div>
        </div>
      </section>
      <section className="studio-system px-4">
        <div className="site-shell studio-system-grid">
          <div>
            <p className="site-eyebrow">One connected experience</p>
            <h2>
              Ask from your phone.
              <br />
              See the next step.
            </h2>
            <p>
              Customer questions, bookings, follow-up and approved knowledge can
              become one workflow. Your team reviews what matters and stays in
              control.
            </p>
            <p className="studio-caption">
              Interactive concept preview. All activity and numbers here are
              simulated.
            </p>
            <Link href="/explore?industry=local%20business">
              Explore how it could work <ArrowRight size={18} />
            </Link>
            <p className="studio-caption">
              The Mayor also has a separate private workspace. <a href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer" className="underline">Open the customer sign-in</a>. Public website discovery does not connect to your account.
            </p>
          </div>
          <HomeProductPreview />
        </div>
      </section>
      <section className="studio-delivery px-4">
        <div className="site-shell">
          <div className="studio-section-heading">
            <div>
              <p className="site-eyebrow">From a question to a useful system</p>
              <h2>
                Small enough to start.
                <br />
                Shaped enough to matter.
              </h2>
            </div>
            <Link href="/pricing">
              Understand scope and costs <ArrowRight size={18} />
            </Link>
          </div>
          <ol>
            {[
              [
                "Discover",
                "Understand the workflow, people, approved knowledge and tools.",
              ],
              [
                "Build",
                "Design the smallest useful system and test real scenarios.",
              ],
              [
                "Launch",
                "Connect agreed tools, permissions and human handoffs.",
              ],
              [
                "Improve",
                "Monitor actual use and refine with ongoing support.",
              ],
            ].map(([title, detail], i) => (
              <li key={title}>
                <span>0{i + 1}</span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <section className="studio-proof px-4">
        <div className="site-shell studio-system-grid">
          <div>
            <p className="site-eyebrow">Founder-led engineering</p>
            <h2>
              Work with the person
              <br />
              building your system.
            </h2>
            <p>
              MehyarSoft connects product design and engineering with the
              practical realities of your business. Scope, operating costs,
              access and support are agreed before implementation.
            </p>
            <Link href="/about">
              Meet Mehyar <ArrowRight size={18} />
            </Link>
          </div>
          <div className="studio-proof-links">
            <Link href="/portfolio">
              <span>01 / Work</span>
              <strong>Explore the workflow patterns</strong>
              <p>Clearly labeled examples of what a system could deliver.</p>
              <ArrowRight />
            </Link>
            <Link href="/apps">
              <span>02 / Products & labs</span>
              <strong>See the products we build</strong>
              <p>Owned software, separate from measured client results.</p>
              <ArrowRight />
            </Link>
          </div>
        </div>
      </section>
      <section className="studio-faq px-4">
        <div className="site-shell">
          <h2>Before we build</h2>
          {[
            [
              "Can you work with our existing tools?",
              "We review integration options, access and scope first. Existing tools can remain part of the solution where their APIs and permissions allow it.",
            ],
            [
              "What makes the AI custom?",
              "Your approved knowledge, workflows, integrations, permissions and human review rules shape the system.",
            ],
            [
              "What does it cost to run?",
              "Build scope, hosting, model usage, messaging and third-party tools are discussed separately. Custom prices need a scoped quote.",
            ],
            [
              "Who controls data and actions?",
              "Data access, ownership and support terms are agreed for each project. Sensitive actions need explicit rules and appropriate human review.",
            ],
          ].map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="px-4 py-14 bg-secondary"><div className="site-shell enterprise-intro"><div><p className="site-eyebrow">From a neighborhood business to an enterprise team</p><h2 className="mt-4 text-4xl font-semibold tracking-tight">The scale changes.<br/>The work still comes first.</h2><p className="mt-5 leading-8 text-muted-foreground">Customer experience for a local business. Approved knowledge for a technology team. A controlled pilot in healthcare, pharma or finance. The system should fit the people, tools and responsibilities around it.</p><Link className="mayor-primary w-fit" href="/enterprise">Enterprise & regulated teams <ArrowRight size={17}/></Link></div><figure><img src="/assets/agent-services/learning-operations-assistant.webp" alt="Illustration of knowledge, documents and operations connected around an assistant" width="800" height="600" loading="lazy"/><figcaption className="mt-3 text-xs text-muted-foreground">Illustrative workflow concept.</figcaption></figure></div></section>
      <section className="studio-insights px-4"><div className="site-shell"><div className="studio-section-heading"><div><p className="site-eyebrow">Insights</p><h2>A little clarity for the next decision.</h2></div><Link href="/blog">All insights <ArrowRight size={18}/></Link></div><div className="studio-insights-grid">{[blogPosts[0],blogPosts[2],blogPosts[7]].map(post=><article key={post.id}><Link href={`/blog/${post.slug}`}><img src={post.image} alt={`${post.category} article illustration`} width="800" height="500" loading="lazy"/></Link><h3><Link href={`/blog/${post.slug}`}>{post.title}</Link></h3><p>{post.excerpt}</p><Link href={`/blog/${post.slug}`}>Read insight <ArrowRight size={16}/></Link></article>)}</div></div></section>
      <MayorPwaShowcase/>
      <section className="studio-final px-4">
        <div className="site-shell">
          <p className="site-eyebrow">Make it yours</p>
          <h2>
            What could work better
            <br />
            in your business?
          </h2>
          <p>Explore with AI, or bring your idea straight to Mehyar.</p>
          <div>
            <Link href="/explore">
              Ask a question <ArrowRight size={18} />
            </Link>
            <Link href="/contact">
              Discuss your business <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
