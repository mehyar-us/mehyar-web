import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import WhyChooseUs from "@/components/why-choose-us";
import TestimonialsSection from "@/components/testimonials-section";
import PricingSection from "@/components/pricing-section";
import ContactSection from "@/components/contact-section";
import { useEffect } from "react";

const Home = () => {
  useEffect(() => {
    document.title = "MehyarSoft LLC - Senior Systems, Software & AI Automation Consultant";
  }, []);

  return (
    <>
      <HeroSection />
      <WhyChooseUs />
      <TestimonialsSection />
      <PricingSection />
      <ContactSection />
    </>
  );
};

export default Home;
