/**
 * public-routes.ts — which non-API paths the worker serves straight from ASSETS.
 * Everything else that reaches the public fallback gets a real 404 page
 * (never the app shell with a 200). Unit-tested in tests/sales-v2.test.ts.
 */

/** Slugs of the public vertical sales pages (see scripts/gen-sales-verticals.mjs). */
export const SALES_VERTICAL_SLUGS=[
  'salon','restaurant','plumbing-hvac','dental','auto-repair','pet-grooming','med-spa',
] as const;

const SALES_VERTICAL_PATHS=new Set(
  (SALES_VERTICAL_SLUGS as readonly string[]).flatMap(slug=>[`/sales/${slug}`,`/sales/${slug}/`]),
);

/** Paths the public web may request directly from ASSETS. */
export function isPublicAssetPath(path:string):boolean{
  if(path==='/'||path==='/index.html')return true;
  if(path==='/terms'||path==='/terms.html')return true;
  if(path==='/robots.txt'||path==='/sitemap.xml'||path==='/favicon.ico')return true;
  if(path==='/sw.js'||path==='/manifest.webmanifest'||path==='/microphone-worklet.js')return true;
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
