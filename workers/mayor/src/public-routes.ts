/**
 * public-routes.ts — which non-API paths the worker serves straight from ASSETS.
 * Everything else that reaches the public fallback gets a real 404 page
 * (never the app shell with a 200). Unit-tested in tests/sales-v2.test.ts.
 *
 * Trailing slashes are normalized ONCE at the worker's fetch entry
 * (see normalizePathname), so every matcher below only needs the bare form.
 */

/**
 * Strip a single trailing slash (except the root "/") so /terms/, /pricing/,
 * /api/billing/catalog/ etc. route exactly like their bare forms. Call once
 * at the top of the worker's request handler, before any route matching.
 */
export function normalizePathname(path:string):string{
  return path.length>1&&path.endsWith('/')?path.slice(0,-1):path;
}

/** Slugs of the public vertical sales pages (see scripts/gen-sales-verticals.mjs). */
export const SALES_VERTICAL_SLUGS=[
  'salon','restaurant','plumbing-hvac','dental','auto-repair','pet-grooming','med-spa',
] as const;

const SALES_VERTICAL_PATHS=new Set(
  (SALES_VERTICAL_SLUGS as readonly string[]).map(slug=>`/sales/${slug}`),
);

/** Paths the public web may request directly from ASSETS. */
export function isPublicAssetPath(path:string):boolean{
  if(path==='/'||path==='/index.html')return true;
  if(path==='/terms'||path==='/terms.html')return true;
  if(path==='/pricing'||path==='/pricing.html')return true;
  if(path==='/robots.txt'||path==='/sitemap.xml'||path==='/favicon.ico')return true;
  if(path==='/sw.js'||path==='/manifest.webmanifest'||path==='/manifest.json'||path==='/microphone-worklet.js')return true;
  if(path==='/icon-180.png'||path==='/icon-192.png'||path==='/icon-512.png'||path==='/mayor-avatar.png')return true;
  if(path==='/device-check'||path==='/device-check.html')return true;
  if(path==='/404.html')return true;
  if(path.startsWith('/assets/'))return true;
  return false;
}

/** True when the path is one of the public vertical sales pages. */
export function isSalesVerticalPath(path:string):boolean{
  return SALES_VERTICAL_PATHS.has(path);
}
