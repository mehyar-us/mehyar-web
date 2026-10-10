/** Inline 404 page (web/public/404.html). Kept inline because the asset
 * server 307-redirects .html to clean paths, which empties subrequest bodies.
 * tests/sales-v2.test.ts asserts this matches the file byte-for-byte. */
export const NOT_FOUND_HTML=`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#102b47">
  <meta name="description" content="That page doesn't exist. The Mayor is your AI chief of staff for local business — start on the sales page or sign in.">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="stylesheet" href="/sales.css">
  <title>Not found · The Mayor</title>
</head>
<body>
  <a class="skip-link" href="#notfound-content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="https://mehyar.us/" aria-label="Mehyar US home"><img src="/icon-192.png" alt="" width="42" height="42"><span>The Mayor<small>BY MEHYAR US</small></span></a>
    <div class="header-ctas">
      <a class="text-link" href="/">Sign in</a>
      <a class="button button-small" href="/sales">See how it works</a>
    </div>
  </header>

  <main id="notfound-content" tabindex="-1">
    <section class="hero page-width" aria-labelledby="notfound-heading">
      <div class="hero-copy">
        <span class="section-kicker">404 · NOT FOUND</span>
        <h1 id="notfound-heading">That page isn't on the books.</h1>
        <p class="hero-description">The address you asked for doesn't exist. The Mayor itself is very much open for business — here's where to go instead.</p>
        <div class="hero-ctas">
          <a class="button" href="/sales">How The Mayor works</a>
          <a class="button button-outline" href="/">Sign in</a>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer page-width">
    <p class="footer-brand">The Mayor <small>BY MEHYARSOFT LLC</small></p>
    <nav aria-label="Footer">
      <a href="/terms">Terms</a>
      <a href="https://mehyar.us/privacy-policy/" target="_blank" rel="noopener noreferrer">Privacy</a>
      <a href="https://mehyar.us/terms/" target="_blank" rel="noopener noreferrer">Company terms</a>
      <a href="https://mehyar.us/data-deletion/" target="_blank" rel="noopener noreferrer">Data deletion</a>
      <a href="mailto:info@mehyar.us">info@mehyar.us</a>
    </nav>
    <p class="footer-note">© 2026 MehyarSoft LLC. All rights reserved.</p>
  </footer>

</body>
</html>
`;
