import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import WhyChooseUs from "@/components/why-choose-us";
import PortfolioSection from "@/components/portfolio-section";
import AboutSection from "@/components/about-section";
import CTASection from "@/components/cta-section";
import ContactSection from "@/components/contact-section";
import { useEffect } from "react";

const Home = () => {
  useEffect(() => {
    document.title = "Mehyar Swelim | Staff Software Engineer | AI, Cloud, DevOps & Platform Architecture";
  }, []);

  return (
    <>
      <HeroSection />
      <ServicesSection />
      <WhyChooseUs />
      <PortfolioSection />
      <AboutSection />
      <CTASection />
      <ContactSection />
    </>
  );
};

export default Home;
