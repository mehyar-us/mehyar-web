import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import IndustryPricingExplorer from "@/components/industry-pricing-explorer";
import MaintenanceSupportSection from "@/components/maintenance-support-section";
import HomeCtaSection from "@/components/HomeCtaSection";

const Home = () => {
  return (
    <>
      <HeroSection />
      <IndustryPricingExplorer compact />
      <ServicesSection />
      <MaintenanceSupportSection compact />
      <HomeCtaSection />
    </>
  );
};

export default Home;
