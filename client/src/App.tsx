import { Router, Switch, Route } from "wouter";
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
import Admin from "@/pages/Admin";
import Unsubscribe from "@/pages/Unsubscribe";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import Terms from "@/pages/Terms";
import Sitemap from "@/pages/Sitemap";
import NotFound from "@/pages/not-found";
import MainLayout from "@/layouts/MainLayout";
import SeoManager from "@/components/SeoManager";
import { useEffect } from "react";

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
        <SeoManager />
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
            <Route path="/contact" component={Contact} />
            <Route path="/admin" component={Admin} />
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
