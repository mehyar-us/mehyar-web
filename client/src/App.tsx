import { Router, Switch, Route, useLocation } from "wouter";
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
import Admin from "@/pages/Admin";
import AdminNow from "@/pages/AdminNow";
import AdminCRM from "@/pages/AdminCRM";
import AdminMoney from "@/pages/AdminMoney";
import AdminSystem from "@/pages/AdminSystem";
// legacy pages kept around for backwards-compatible deep-links, but routed away in the SPA nav
import AdminProspects, { AdminProspectsProtected } from "@/pages/AdminProspects";
import AdminToday from "@/pages/AdminToday";
import AdminAudit from "@/pages/AdminAudit";
import AdminOpportunities from "@/pages/AdminOpportunities";
import AdminOpportunityDetail from "@/pages/AdminOpportunityDetail";
import AdminProspectSources from "@/pages/AdminProspectSources";
import AdminOutreach from "@/pages/AdminOutreach";
import AdminAutoTender from "@/pages/AdminAutoTender";
import AdminReplies from "@/pages/AdminReplies";
import Unsubscribe from "@/pages/Unsubscribe";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import Sitemap from "@/pages/Sitemap";
import NotFound from "@/pages/not-found";
import MainLayout from "@/layouts/MainLayout";
import SeoManager from "@/components/SeoManager";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import { useEffect } from "react";

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
  // Initialize theme from localStorage
  useEffect(() => {
    const isDarkMode = localStorage.getItem("darkMode") === "true";
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
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
            <Route path="/admin" component={AdminNow} />
            <Route path="/admin/leads" component={AdminCRM} />
            <Route path="/admin/leads/:kind/:id" component={AdminOpportunityDetail} />
            <Route path="/admin/money" component={AdminMoney} />
            <Route path="/admin/system" component={AdminSystem} />
        <Route path="/admin/prospects" component={AdminProspectsProtected} />
        <Route path="/admin/today" component={AdminToday} />
        <Route path="/admin/auto-tender" component={AdminAutoTender} />
        <Route path="/admin/audit" component={AdminAudit} />
        <Route path="/admin/opportunities" component={AdminOpportunities} />
        <Route path="/admin/opportunities/:id" component={AdminOpportunityDetail} />
        <Route path="/admin/prospect-sources" component={AdminProspectSources} />
        <Route path="/admin/outreach" component={AdminOutreach} />
        <Route path="/admin/replies" component={AdminReplies} />
            <Route path="/admin/analytics" component={Admin} />
            <Route path="/admin/newsletter" component={Admin} />
            <Route path="/admin/government" component={Admin} />
            <Route path="/admin/government/:opportunityId" component={Admin} />
            <Route path="/admin/opportunity-scout" component={Admin} />
            <Route path="/admin/billing" component={Admin} />
            <Route path="/admin/email" component={Admin} />
            <Route path="/admin/email/thread/:threadId" component={Admin} />
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
