import { Router, Switch, Route, useLocation } from "wouter";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import Home from "@/pages/Home";
import Services from "@/pages/Services";
import Portfolio from "@/pages/Portfolio";
import PortfolioDetail from "@/pages/PortfolioDetail";
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
import AdminNow from "@/pages/AdminNow";
import AdminCRM from "@/pages/AdminCRM";
import AdminMoney from "@/pages/AdminMoney";
import AdminSystem from "@/pages/AdminSystem";
import AdminOpportunityDetail from "@/pages/_deprecated/AdminOpportunityDetail";
import Unsubscribe from "@/pages/Unsubscribe";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import Sitemap from "@/pages/Sitemap";
import NotFound from "@/pages/not-found";
import MainLayout from "@/layouts/MainLayout";
import SeoManager from "@/components/SeoManager";
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
      "^" + href.replace(/:[a-zA-Z_]+/g, (m) => {
        paramNames.push(m.slice(1));
        return "([^/]+)";
      }) + "$"
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
    const currentPath = window.location.pathname + window.location.search;
    const hash = window.location.hash;

    window.requestAnimationFrame(() => {
      if (hash && location === currentPath) {
        document.querySelector(hash)?.scrollIntoView({ block: "start", behavior: "auto" });
        return;
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [location]);

  return null;
}

function App() {
  // Initialize theme from localStorage — but FORCE LIGHT MODE on /admin/* paths
  // because the admin UI uses raw light-mode Tailwind classes (bg-white, text-zinc-700, etc.)
  // and renders dark-on-dark in dark mode. Marketing pages keep the toggle.
  useEffect(() => {
    const isAdmin = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
    const isDarkMode = localStorage.getItem("darkMode") === "true";
    if (isDarkMode && !isAdmin) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      if (isAdmin) document.documentElement.classList.add("force-light");
    }
  }, []);

  return (
    <>
      <Router>
        <ScrollToTop />
        <SeoManager />
        <GoogleAnalytics />
        <MainLayout>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/services" component={Services} />
            <Route path="/portfolio" component={Portfolio} />
            <Route path="/portfolio/:id" component={PortfolioDetail} />
            <Route path="/blog" component={Blog} />
            <Route path="/blog/:slug" component={BlogPost} />
            <Route path="/newsletter" component={Newsletter} />
            <Route path="/free-checklist" component={Newsletter} />
            <Route path="/about" component={About} />
            <Route path="/330" component={MicroOffer} />
            <Route path="/micro-offer" component={MicroOffer} />
            <Route path="/booking" component={Booking} />
            <Route path="/book" component={Booking} />
            <Route path="/contact" component={Contact} />
            <Route path="/billing/checkout" component={BillingCheckout} />
            <Route path="/billing/checkout/:serviceId" component={BillingCheckout} />
            <Route path="/billing/success" component={BillingSuccess} />
            <Route path="/billing/cancel" component={BillingCancel} />
            <Route path="/q/:slug" component={QuoteView} />
            <Route path="/admin" component={AdminNow} />
            <Route path="/admin/leads" component={AdminCRM} />
            <Route path="/admin/leads/:kind/:id" component={AdminOpportunityDetail} />
            <Route path="/admin/money" component={AdminMoney} />
            <Route path="/admin/system" component={AdminSystem} />
            <Redirect to="/admin/leads?kind=prospect" href="/admin/prospects" />
            <Redirect to="/admin" href="/admin/today" />
            <Redirect to="/admin/money" href="/admin/auto-tender" />
            <Redirect to="/admin/system" href="/admin/audit" />
            <Redirect to="/admin/leads?kind=sam" href="/admin/opportunities" />
            <Redirect to="/admin/leads/sam/:id" href="/admin/opportunities/:id" />
            <Redirect to="/admin/leads?sources=1" href="/admin/prospect-sources" />
            <Redirect to="/admin/money" href="/admin/outreach" />
            <Redirect to="/admin/leads" href="/admin/replies" />
            <Redirect to="/admin/system" href="/admin/analytics" />
            <Redirect to="/admin/system" href="/admin/newsletter" />
            <Redirect to="/admin/leads?kind=sam" href="/admin/government" />
            <Redirect to="/admin/leads/sam/:opportunityId" href="/admin/government/:opportunityId" />
            <Redirect to="/admin/leads" href="/admin/opportunity-scout" />
            <Redirect to="/admin/money" href="/admin/billing" />
            <Redirect to="/admin/leads" href="/admin/email" />
            <Redirect to="/admin/leads" href="/admin/email/thread/:threadId" />
            <Route path="/unsubscribe" component={Unsubscribe} />
            <Route path="/privacy-policy" component={PrivacyPolicy} />
            <Route path="/terms" component={Terms} />
            <Route path="/sitemap" component={Sitemap} />

            <Route component={NotFound} />
          </Switch>
        </MainLayout>
      </Router>
      <Toaster />
    </>
  );
}

export default App;