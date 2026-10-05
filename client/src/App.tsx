import Explore from "@/pages/Explore";
import Enterprise from "@/pages/Enterprise";
import Mayor from "@/pages/Mayor";
import { ExplorerProvider } from "@/components/VisualExplorer";
import { Router, Switch, Route, useLocation } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { useStrippedLocation } from "@/hooks/useStrippedLocation";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/Home";
import Audit from "@/pages/Audit";
import AuditReport from "@/pages/AuditReport";
import Services from "@/pages/Services";
import Pricing from "@/pages/Pricing";
import Industries from "@/pages/Industries";
import IndustryDetail from "@/pages/IndustryDetail";
import Portfolio from "@/pages/Portfolio";
import PortfolioDetail from "@/pages/PortfolioDetail";
import Apps from "@/pages/Apps";
import Blog from "@/pages/Blog";
import BlogPost from "@/pages/BlogPost";
import Newsletter from "@/pages/Newsletter";
import About from "@/pages/About";
import Contact from "@/pages/Contact";
import MicroOffer from "@/pages/MicroOffer";
import Booking from "@/pages/Booking";
import BillingCheckout from "@/pages/BillingCheckout";
import { BillingCancel, BillingSuccess } from "@/pages/BillingResult";
import QuoteView from "@/pages/QuoteView";
import ProposalPublic from "@/pages/ProposalPublic";
import ProposalsDirectory from "@/pages/ProposalsDirectory";
const CenterHome = lazy(() => import("@/center/pages/Home"));
const CenterBrandDetail = lazy(() => import("@/center/pages/BrandDetail"));
const CenterToday = lazy(() => import("@/center/pages/Today"));
const CenterCampaigns = lazy(() => import("@/center/pages/Campaigns"));
const CenterHealth = lazy(() => import("@/center/pages/Health"));
const CenterRevenue = lazy(() => import("@/center/pages/Revenue"));
import Unsubscribe from "@/pages/Unsubscribe";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import Sitemap from "@/pages/Sitemap";
import DataDeletion from "@/pages/DataDeletion";
import NotFound from "@/pages/not-found";
import MainLayout from "@/layouts/MainLayout";
import SeoManager from "@/components/SeoManager";
import LocalPerformanceProbe from "@/components/LocalPerformanceProbe";
import GoogleAnalytics from "@/components/GoogleAnalytics";

// ── Custom redirect component ─────────────────────────────────────────
// wouter's built-in <Redirect to="/x" /> does an exact-path match.
// We need PATTERN-based redirects like /admin/opportunities/:id → /admin/leads/sam/:id
// so this component matches the `href` pattern and rewrites to `to` with captured params.
function Redirect({ to, href }: { to: string; href: string }) {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    const paramNames: string[] = [];
    const re = new RegExp(
      "^" +
        href.replace(/:[a-zA-Z_]+/g, (m) => {
          paramNames.push(m.slice(1));
          return "([^/]+)";
        }) +
        "$",
    );
    const m = location.match(re);
    if (m) {
      let target = to;
      m.slice(1).forEach((val, i) => {
        target = target.replace(`:${paramNames[i]}`, val);
      });
      setLocation(target, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);
  return null;
}

function ScrollToTop() {
  const [location] = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    let anchor = hash.slice(1);
    try {
      anchor = decodeURIComponent(anchor);
    } catch {
      /* A malformed hash should not break the page. */
    }

    window.requestAnimationFrame(() => {
      if (hash) {
        document
          .getElementById(anchor)
          ?.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [location]);

  return null;
}

function DashboardHostRedirect() {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (
      window.location.hostname === "dashboard.mehyar.us" &&
      !location.startsWith("/admin")
    ) {
      setLocation("/admin", { replace: true });
    }
  }, [location, setLocation]);
  return null;
}

function App({ ssrPath }: { ssrPath?: string } = {}) {
  // Initialize theme from localStorage.
  // The useTheme hook (used by ThemeToggle component) also manages the .dark
  // class, but we apply it here once on mount so the first paint is correct
  // and matches the user's saved preference (no flash of wrong theme).
  useEffect(() => {
    const saved = localStorage.getItem("darkMode");
    const wantsDark = saved === "true";
    document.documentElement.classList.toggle("dark", wantsDark);
  }, []);

  return (
    <>
      <Router hook={useStrippedLocation} ssrPath={ssrPath}>
        <ScrollToTop />
        <DashboardHostRedirect />
        <SeoManager />
        <GoogleAnalytics />
        <LocalPerformanceProbe />
        <ExplorerProvider><MainLayout>
          <Suspense
            fallback={
              <p role="status" className="site-hero">
                Loading page…
              </p>
            }
          >
            <Switch>
              {/* ─── Public marketing + legal pages ─────────────────────────────
                Every route gets both a no-slash AND trailing-slash form because
                CF Pages auto-trailing-slashes every served path, and Wouter's
                <Route> is exact-match by default. Without the aliases, hitting
                /privacy-policy (the canonical form) 302's to /privacy-policy/
                and Wouter never finds a matching <Route>, so <main> is empty. */}
              <Route path="/" component={Home} />
              <Route path="/explore" component={Explore} />
              <Route path="/mayor" component={Mayor} />
              <Route path="/enterprise" component={Enterprise} />
              <Route path="/services" component={Services} />
              <Route path="/services/" component={Services} />
              <Route path="/pricing" component={Pricing} />
              <Route path="/pricing/" component={Pricing} />
              <Route path="/industries" component={Industries} />
              <Route path="/industries/" component={Industries} />
              <Route path="/industries/:slug" component={IndustryDetail} />
              <Route path="/industries/:slug/" component={IndustryDetail} />
              <Route path="/portfolio" component={Portfolio} />
              <Route path="/portfolio/" component={Portfolio} />
              <Route path="/portfolio/:id" component={PortfolioDetail} />
              <Route path="/portfolio/:id/" component={PortfolioDetail} />
              <Route path="/apps" component={Apps} />
              <Route path="/apps/" component={Apps} />
              <Route path="/blog" component={Blog} />
              <Route path="/blog/" component={Blog} />
              <Route path="/blog/:slug" component={BlogPost} />
              <Route path="/blog/:slug/" component={BlogPost} />
              <Route path="/newsletter" component={Newsletter} />
              <Route path="/newsletter/" component={Newsletter} />
              <Route path="/free-checklist" component={Newsletter} />
              <Route path="/free-checklist/" component={Newsletter} />
              <Route path="/about" component={About} />
              <Route path="/about/" component={About} />
              <Route path="/330" component={MicroOffer} />
              <Route path="/330/" component={MicroOffer} />
              <Route path="/micro-offer" component={MicroOffer} />
              <Route path="/micro-offer/" component={MicroOffer} />
              <Route path="/booking" component={Booking} />
              <Route path="/booking/" component={Booking} />
              <Route path="/book" component={Booking} />
              <Route path="/book/" component={Booking} />
              <Route path="/contact" component={Contact} />
              <Route path="/contact/" component={Contact} />
              <Route path="/audit" component={Audit} />
              <Route path="/audit/" component={Audit} />
              <Route path="/audit/report" component={AuditReport} />
              <Route path="/audit/report/" component={AuditReport} />
              <Route path="/billing/checkout" component={BillingCheckout} />
              <Route path="/billing/checkout/" component={BillingCheckout} />
              <Route
                path="/billing/checkout/:serviceId"
                component={BillingCheckout}
              />
              <Route
                path="/billing/checkout/:serviceId/"
                component={BillingCheckout}
              />
              <Route path="/billing/success" component={BillingSuccess} />
              <Route path="/billing/success/" component={BillingSuccess} />
              <Route path="/billing/cancel" component={BillingCancel} />
              <Route path="/billing/cancel/" component={BillingCancel} />
              <Route path="/q/:slug" component={QuoteView} />
              <Route path="/q/:slug/" component={QuoteView} />
              <Route path="/proposals" component={ProposalsDirectory} />
              <Route path="/proposals/" component={ProposalsDirectory} />
              <Route path="/proposals/:slug" component={ProposalPublic} />
              <Route path="/proposals/:slug/" component={ProposalPublic} />

              {/* ─── Command Center ─────────────────────────────────────────
                /admin            → brand grid landing
                /admin/brand/:id  → per-brand detail (campaigns, links,
                                    templates, warmup, health, revenue)
                /admin/today      → today's campaigns across brands
                /admin/campaigns  → campaign timeline across brands
                /admin/health     → alerts, deliverability, learnings
                /admin/revenue    → revenue overview
                Each route ships with both the bare and trailing-slash alias
                because CF Pages auto-trailing-slashes every served path. */}
              <Route path="/admin" component={CenterHome} />
              <Route path="/admin/" component={CenterHome} />
              <Route path="/admin/brand/:id" component={CenterBrandDetail} />
              <Route path="/admin/brand/:id/" component={CenterBrandDetail} />
              <Route path="/admin/today" component={CenterToday} />
              <Route path="/admin/today/" component={CenterToday} />
              <Route path="/admin/campaigns" component={CenterCampaigns} />
              <Route path="/admin/campaigns/" component={CenterCampaigns} />
              <Route path="/admin/health" component={CenterHealth} />
              <Route path="/admin/health/" component={CenterHealth} />
              <Route path="/admin/revenue" component={CenterRevenue} />
              <Route path="/admin/revenue/" component={CenterRevenue} />

              {/* ─── Old agency-dashboard routes → command center ──── */}
              <Route path="/admin/now">
                <Redirect to="/admin" href="/admin/now" />
              </Route>
              <Route path="/admin/now/">
                <Redirect to="/admin" href="/admin/now/" />
              </Route>
              <Route path="/admin/mayor">
                <Redirect to="/admin" href="/admin/mayor" />
              </Route>
              <Route path="/admin/mayor/">
                <Redirect to="/admin" href="/admin/mayor/" />
              </Route>
              <Route path="/admin/clients">
                <Redirect to="/admin" href="/admin/clients" />
              </Route>
              <Route path="/admin/clients/">
                <Redirect to="/admin" href="/admin/clients/" />
              </Route>
              <Route path="/admin/leads">
                <Redirect to="/admin" href="/admin/leads" />
              </Route>
              <Route path="/admin/leads/">
                <Redirect to="/admin" href="/admin/leads/" />
              </Route>
              <Route path="/admin/sent">
                <Redirect to="/admin/campaigns" href="/admin/sent" />
              </Route>
              <Route path="/admin/sent/">
                <Redirect to="/admin/campaigns" href="/admin/sent/" />
              </Route>
              <Route path="/admin/money">
                <Redirect to="/admin/revenue" href="/admin/money" />
              </Route>
              <Route path="/admin/money/">
                <Redirect to="/admin/revenue" href="/admin/money/" />
              </Route>
              <Route path="/admin/system">
                <Redirect to="/admin/health" href="/admin/system" />
              </Route>
              <Route path="/admin/system/">
                <Redirect to="/admin/health" href="/admin/system/" />
              </Route>
              <Route path="/admin/jobs">
                <Redirect to="/admin" href="/admin/jobs" />
              </Route>
              <Route path="/admin/jobs/">
                <Redirect to="/admin" href="/admin/jobs/" />
              </Route>

              {/* ─── Legal + utility — must come BEFORE the legacy
                 <Redirect> block. The Switch returns the first matching
                 <Route>; if any <Redirect> appears before these, a wouter
                 cache mismatch left them unmatched. ──────────────────── */}
              <Route path="/unsubscribe" component={Unsubscribe} />
              <Route path="/unsubscribe/" component={Unsubscribe} />
              <Route path="/privacy-policy" component={PrivacyPolicy} />
              <Route path="/privacy-policy/" component={PrivacyPolicy} />
              <Route path="/terms" component={Terms} />
              <Route path="/terms/" component={Terms} />
              <Route path="/sitemap" component={Sitemap} />
              <Route path="/sitemap/" component={Sitemap} />
              <Route path="/data-deletion" component={DataDeletion} />
              <Route path="/data-deletion/" component={DataDeletion} />

              {/* ─── Legacy admin route redirects (both slash forms) ──── */}
              <Route path="/admin/prospects">
                <Redirect
                  to="/admin/leads?kind=prospect"
                  href="/admin/prospects"
                />
              </Route>
              <Route path="/admin/prospects/">
                <Redirect
                  to="/admin/leads?kind=prospect"
                  href="/admin/prospects/"
                />
              </Route>
              <Route path="/admin/today">
                <Redirect to="/admin/now" href="/admin/today" />
              </Route>
              <Route path="/admin/today/">
                <Redirect to="/admin/now" href="/admin/today/" />
              </Route>
              <Route path="/admin/auto-tender">
                <Redirect to="/admin/money" href="/admin/auto-tender" />
              </Route>
              <Route path="/admin/auto-tender/">
                <Redirect to="/admin/money" href="/admin/auto-tender/" />
              </Route>
              <Route path="/admin/audit">
                <Redirect to="/admin/system" href="/admin/audit" />
              </Route>
              <Route path="/admin/audit/">
                <Redirect to="/admin/system" href="/admin/audit/" />
              </Route>
              <Route path="/admin/opportunities">
                <Redirect
                  to="/admin/leads?kind=sam"
                  href="/admin/opportunities"
                />
              </Route>
              <Route path="/admin/opportunities/">
                <Redirect
                  to="/admin/leads?kind=sam"
                  href="/admin/opportunities/"
                />
              </Route>
              <Route path="/admin/opportunities/:id">
                <Redirect
                  to="/admin/leads/sam/:id"
                  href="/admin/opportunities/:id"
                />
              </Route>
              <Route path="/admin/opportunities/:id/">
                <Redirect
                  to="/admin/leads/sam/:id/"
                  href="/admin/opportunities/:id/"
                />
              </Route>
              <Route path="/admin/prospect-sources">
                <Redirect
                  to="/admin/leads?sources=1"
                  href="/admin/prospect-sources"
                />
              </Route>
              <Route path="/admin/prospect-sources/">
                <Redirect
                  to="/admin/leads?sources=1"
                  href="/admin/prospect-sources/"
                />
              </Route>
              <Route path="/admin/outreach">
                <Redirect to="/admin/money" href="/admin/outreach" />
              </Route>
              <Route path="/admin/outreach/">
                <Redirect to="/admin/money" href="/admin/outreach/" />
              </Route>
              <Route path="/admin/replies">
                <Redirect to="/admin/leads" href="/admin/replies" />
              </Route>
              <Route path="/admin/replies/">
                <Redirect to="/admin/leads" href="/admin/replies/" />
              </Route>
              <Route path="/admin/analytics">
                <Redirect to="/admin/system" href="/admin/analytics" />
              </Route>
              <Route path="/admin/analytics/">
                <Redirect to="/admin/system" href="/admin/analytics/" />
              </Route>
              <Route path="/admin/newsletter">
                <Redirect to="/admin/system" href="/admin/newsletter" />
              </Route>
              <Route path="/admin/newsletter/">
                <Redirect to="/admin/system" href="/admin/newsletter/" />
              </Route>
              <Route path="/admin/government">
                <Redirect to="/admin/leads?kind=sam" href="/admin/government" />
              </Route>
              <Route path="/admin/government/">
                <Redirect
                  to="/admin/leads?kind=sam"
                  href="/admin/government/"
                />
              </Route>
              <Route path="/admin/government/:opportunityId">
                <Redirect
                  to="/admin/leads/sam/:opportunityId"
                  href="/admin/government/:opportunityId"
                />
              </Route>
              <Route path="/admin/government/:opportunityId/">
                <Redirect
                  to="/admin/leads/sam/:opportunityId/"
                  href="/admin/government/:opportunityId/"
                />
              </Route>
              <Route path="/admin/opportunity-scout">
                <Redirect to="/admin/leads" href="/admin/opportunity-scout" />
              </Route>
              <Route path="/admin/opportunity-scout/">
                <Redirect to="/admin/leads" href="/admin/opportunity-scout/" />
              </Route>
              <Route path="/admin/billing">
                <Redirect to="/admin/money" href="/admin/billing" />
              </Route>
              <Route path="/admin/billing/">
                <Redirect to="/admin/money" href="/admin/billing/" />
              </Route>
              <Route path="/admin/email">
                <Redirect to="/admin/leads" href="/admin/email" />
              </Route>
              <Route path="/admin/email/">
                <Redirect to="/admin/leads" href="/admin/email/" />
              </Route>
              <Route path="/admin/email/thread/:threadId">
                <Redirect
                  to="/admin/leads"
                  href="/admin/email/thread/:threadId"
                />
              </Route>
              <Route path="/admin/email/thread/:threadId/">
                <Redirect
                  to="/admin/leads"
                  href="/admin/email/thread/:threadId/"
                />
              </Route>

              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </MainLayout></ExplorerProvider>
      </Router>
      <Toaster />
    </>
  );
}

export default App;
