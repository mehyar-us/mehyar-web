import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import WhyChooseUs from "@/components/why-choose-us";
import PortfolioSection from "@/components/portfolio-section";
import TestimonialsSection from "@/components/testimonials-section";
import BlogSection from "@/components/blog-section";
import AboutSection from "@/components/about-section";
import CTASection from "@/components/cta-section";
import ContactSection from "@/components/contact-section";
import { useEffect } from "react";

const Home = () => {
  useEffect(() => {
    document.title = "MehyarSoft - Custom Web Apps, CRM & Automation Solutions";
  }, []);

  return (
    <>
      <HeroSection />
      <ServicesSection />
      <WhyChooseUs />
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
