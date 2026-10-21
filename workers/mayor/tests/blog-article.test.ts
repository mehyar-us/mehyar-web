/**
 * blog-article.test.ts — SEO blog publish contract (daily SEO engine,
 * Marketing Chief's order 2026-10-20; restyle + rename fix 2026-10-21).
 * Article #1: /blog/front-desk-missed-calls (renamed from
 * /blog/agentic-front-desk-missed-calls by the de-buzzword sweep; the old
 * slug 301s to the new one).
 *
 * Pins: the route is a public asset path (page + images + the shared
 * blog.css), the sitemap carries the current URL, robots allows it, the
 * old slug's file is gone and its 301 lives in src/index.ts, and the
 * served HTML carries the readable article text (not script-only), the
 * metadata, Article + FAQPage JSON-LD, the article's internal links as
 * written — and the blog design stylesheet, NOT the vite-bundled
 * sales.css (whose served path is hashed; linking it 404s and the page
 * renders unstyled — the 2026-10-21 defect this file now guards).
 */
import {describe,expect,it} from 'vitest';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {isPublicAssetPath} from '../src/public-routes';

const here=dirname(fileURLToPath(import.meta.url));
const publicDir=join(here,'..','web','public');
const readPublic=(...parts:string[])=>readFileSync(join(publicDir,...parts),'utf8');

const SLUG='front-desk-missed-calls';
const OLD_SLUG='agentic-front-desk-missed-calls';
const html=readPublic('blog',`${SLUG}.html`);

describe('blog article #1 publish contract',()=>{
  it('route + images + blog.css are public asset paths',()=>{
    expect(isPublicAssetPath(`/blog/${SLUG}`)).toBe(true);
    expect(isPublicAssetPath(`/blog/${SLUG}.html`)).toBe(true);
    expect(isPublicAssetPath('/blog/mayor-missed-call-barbershop.webp')).toBe(true);
    expect(isPublicAssetPath('/blog/mayor-answered-plumber.webp')).toBe(true);
    expect(isPublicAssetPath('/blog/blog.css')).toBe(true);
    expect(isPublicAssetPath('/blog/../etc')).toBe(false);
    expect(existsSync(join(publicDir,'blog','mayor-missed-call-barbershop.webp'))).toBe(true);
    expect(existsSync(join(publicDir,'blog','mayor-answered-plumber.webp'))).toBe(true);
    expect(existsSync(join(publicDir,'blog','blog.css'))).toBe(true);
  });

  it('the renamed slug is canonical; the old file is gone and 301s',()=>{
    expect(existsSync(join(publicDir,'blog',`${OLD_SLUG}.html`))).toBe(false);
    const indexTs=readFileSync(join(here,'..','src','index.ts'),'utf8');
    expect(indexTs).toContain(`url.pathname==='/blog/${OLD_SLUG}'`);
    expect(indexTs).toContain(`'/blog/${SLUG}'`);
    expect(readPublic('sitemap.xml')).toContain(`<loc>https://mayor.mehyar.us/blog/${SLUG}</loc>`);
    expect(readPublic('sitemap.xml')).not.toContain(OLD_SLUG);
    const robots=readPublic('robots.txt');
    expect(robots).toContain('Allow: /');
    expect(robots).not.toContain('Disallow: /blog');
  });

  it('frontmatter metadata is the served head',()=>{
    expect(html).toContain('<title>Missed Calls Cost More Than You Think — The Front Desk That Answers Every Call</title>');
    expect(html).toContain('name="description" content="Every unanswered ring is a customer calling your competitor next.');
    expect(html).toContain(`<link rel="canonical" href="https://mayor.mehyar.us/blog/${SLUG}">`);
    expect(html).toContain('<meta property="og:image" content="https://mayor.mehyar.us/blog/mayor-missed-call-barbershop.webp">');
  });

  it('carries Article + FAQPage JSON-LD',()=>{
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"datePublished":"2026-10-20"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('Do I have to change my number?');
  });

  it('readable article text is in the HTML (not script-only)',()=>{
    expect(html).toContain("Your Phone Is Ringing Right Now. Nobody's Answering It.");
    expect(html).toContain('What The Mayor Does Differently');
    expect(html).toContain('The One-Minute Test');
    expect(html).toContain('<strong>$99/month</strong>');
    expect(html).toContain('<strong>$79.20/month for life</strong>');
    expect(html).not.toContain('Agentic');
  });

  it('design: blog.css drives the page, never the bundled sales.css path',()=>{
    expect(html).toContain('<link rel="stylesheet" href="/blog/blog.css">');
    expect(html).not.toContain('href="/sales.css"');
    const css=readPublic('blog','blog.css');
    expect(css).toContain('.blog-hero');
    expect(css).toContain('.col');
  });

  it('internal links exactly as written in the article',()=>{
    expect(html).toContain('href="https://mayor.mehyar.us/how-much-does-a-missed-call-cost"');
    expect(html).toContain('href="https://mayor.mehyar.us/ai-receptionist-vs-answering-service"');
    expect(html).toContain('href="https://mayor.mehyar.us/missed-call-text-back"');
    expect(html).toContain('href="https://mayor.mehyar.us/sales"');
    expect(html).toContain('alt="A barber mid-haircut while the shop phone rings unanswered');
    expect(html).toContain('alt="A plumbing company owner starting his morning with every call already answered');
  });
});
