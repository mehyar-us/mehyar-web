import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import WhyChooseUs from "@/components/why-choose-us";
import PortfolioSection from "@/components/portfolio-section";
import TestimonialsSection from "@/components/testimonials-section";
import PricingSection from "@/components/pricing-section";
import BlogSection from "@/components/blog-section";
import AboutSection from "@/components/about-section";
import CTASection from "@/components/cta-section";
import ContactSection from "@/components/contact-section";
import { useEffect } from "react";

const Home = () => {
  useEffect(() => {
    document.title = "MehyarSoft LLC - Software, Systems & AI Automation Consulting";
  }, []);

  return (
    <>
      <HeroSection />
      <ServicesSection />
      <WhyChooseUs />
      <PricingSection />
      <PortfolioSection />
      <TestimonialsSection />
      <BlogSection />
      <AboutSection />
      <CTASection />
      <ContactSection />
    </>
  );
};

export default Home;
