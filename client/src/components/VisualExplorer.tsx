import { ArrowRight, Sparkles, Check } from "lucide-react";
import { Link } from "wouter";
import { mayorConcepts } from "@/data/mayor-concepts";
import { industryOffers } from "@/data/industry-offers";
import { useExplorer, VisualAnswer } from "./MayorStore";
export { ExplorerProvider, useExplorer } from "./MayorStore";
export function VisualBoard({
  answer,
  onAsk,
  onNavigate,
}: {
  answer: VisualAnswer;
  onAsk: (q: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <div className="visual-board">
      {answer.blocks.map((block, i) => (
        <section
          key={i}
          className={`visual-block visual-${block.type}`}
          aria-label={block.title}
        >
          <h3>{block.title}</h3>
          {block.type==='concept-gallery'&&<div className="visual-gallery">{block.conceptIds.map(id=><figure key={id}><img src={mayorConcepts[id].image} alt={`${mayorConcepts[id].label}; illustrative concept`} width="800" height="600" loading="lazy"/><figcaption>{mayorConcepts[id].label}<small className="block mt-2">Illustration · no live customer activity</small></figcaption></figure>)}</div>}
          {block.type==='navigation'&&<div className="mayor-navigation-links">{block.links.map(link=>link.path==='https://mayor.mehyar.us'?<a key={link.path} href={link.path} target="_blank" rel="noopener noreferrer"><div><strong>{link.label}</strong><p>{link.detail}</p><small>Sign-in required · separate private workspace</small></div><ArrowRight size={19}/></a>:<Link key={link.path} href={link.path} onClick={onNavigate}><div><strong>{link.label}</strong><p>{link.detail}</p></div><ArrowRight size={19}/></Link>)}</div>}
          {block.type === "workflow" && (
            <ol className="visual-path">
              {block.steps?.map((step, j) => (
                <li key={j}>
                  <span className="path-number">
                    {String(j + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h4>{step.title}</h4>
                    <p>{step.detail}</p>
                    <button
                      onClick={() =>
                        onAsk(
                          `Explain the step ${step.title} in more detail for this workflow`,
                        )
                      }
                    >
                      Explore this step <ArrowRight size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {block.type === "comparison" && (
            <>
            <div className="comparison-cards">
              {block.rows.map((row,j)=><article key={j}><h4>{row.label}</h4><dl><div><dt>{block.leftLabel}</dt><dd>{row.left}</dd></div><div><dt>{block.rightLabel}</dt><dd>{row.right}</dd></div></dl></article>)}
            </div>
            <div
              className="comparison-scroll"
              tabIndex={0}
              role="region"
              aria-label="Scrollable comparison"
            >
              <table>
                <thead>
                  <tr>
                    <th>Consideration</th>
                    <th>{block.leftLabel}</th>
                    <th>{block.rightLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {block.rows?.map((row, j) => (
                    <tr key={j}>
                      <th scope="row">{row.label}</th>
                      <td>{row.left}</td>
                      <td>{row.right}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
          {block.type === "gallery" && (
            <div className="visual-gallery">
              {block.industryIds?.map((id) => {
                const industry = industryOffers.find((x) => x.id === id);
                return industry ? (
                  <figure key={id}>
                    <img
                      src={industry.heroImage}
                      alt={`${industry.shortName} business setting; illustrative imagery`}
                      width="800"
                      height="600"
                      loading="lazy"
                    />
                    <figcaption>
                      {industry.shortName}
                      <button
                        onClick={() =>
                          onAsk(
                            `Apply this explanation to ${industry.shortName}`,
                          )
                        }
                      >
                        Explore this business <ArrowRight size={15} />
                      </button>
                    </figcaption>
                  </figure>
                ) : null;
              })}
            </div>
          )}
          {block.type === "checklist" && (
            <ul className="visual-checklist">
              {block.items?.map((item, j) => (
                <li key={j}>
                  <Check size={18} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          {block.type === "product" && (
            <div className="visual-product">
              <img
                src={`/assets/industries-v2/${block.industryId}.webp`}
                alt="Illustrative business context"
                width="800"
                height="600"
                loading="lazy"
              />
              <div>
                <span className="site-eyebrow">
                  Concept · no live business activity
                </span>
                <p>{block.detail}</p>
                <div className="concept-status">
                  <span>Approved knowledge</span>
                  <ArrowRight size={18} />
                  <span>Prepared response</span>
                  <ArrowRight size={18} />
                  <span>Human review</span>
                </div>
                <button
                  onClick={() =>
                    onAsk(
                      `Show a customer journey for this concept: ${block.title}`,
                    )
                  }
                >
                  Show the journey <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export default function VisualExplorer({compact=false,industry,topic}:{compact?:boolean;industry?:string;topic?:string}) {
  const mayor=useExplorer();
  const questions=topic?[/^(show|compare|explain|plan)\b/i.test(topic)?topic:`Explain ${topic}${industry?` for ${industry}`:''} as a visual workflow`, `Compare approaches to ${topic}`]:industry?[`What could custom AI do for ${industry}?`,`Show a customer journey for ${industry}`]:['What could AI do for my business?','Show me how missed calls become bookings','How could an enterprise team use AI safely?'];
  return <div className={`mayor-entry ${compact?'mayor-entry-compact':''}`}>
    <div className="mayor-entry-top"><img src="/assets/mayor-avatar.webp" alt="The Mayor, illustrated AI companion" width="92" height="92"/><span className="site-eyebrow"><Sparkles size={14}/> Your AI companion</span></div>
    <h2>Ask The Mayor.<br/>See a clearer picture.</h2>
    <p>Talk through an idea. Explore a workflow. Compare your options, with text, visuals and relevant images.</p>
    <button className="mayor-primary" onClick={()=>mayor.launch('',topic||industry||'')}>Start a conversation <ArrowRight size={18}/></button>
    <div className="mayor-entry-prompts">{questions.map((q,i)=><button key={q} onClick={()=>mayor.launch(q)}>{topic&&topic.length>70?(i===0?"Show this as a visual workflow":"Compare practical approaches"):q}<ArrowRight size={15}/></button>)}</div>
    <small>Free to explore. No signup. Public knowledge; no business tools connected.</small>
    <a className="mayor-entry-signin" href="https://mayor.mehyar.us" target="_blank" rel="noopener noreferrer">For your configured business tools, open the private Mayor workspace <ArrowRight size={14}/></a>
  </div>;
}
