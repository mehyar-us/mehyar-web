import HeroSection from "@/components/hero-section";
import HomeAgentCommandCenter from "@/components/HomeAgentCommandCenter";
import ServiceDecisionGuide from "@/components/ServiceDecisionGuide";
import HomeIndustryFinder from "@/components/HomeIndustryFinder";
import MaintenanceSupportSection from "@/components/maintenance-support-section";
import HomeCtaSection from "@/components/HomeCtaSection";

const Home = () => {
  return (
    <>
      <HeroSection />
      <ServiceDecisionGuide compact />
      <HomeIndustryFinder />
      <HomeAgentCommandCenter />
      <MaintenanceSupportSection compact />
      <HomeCtaSection />
    </>
  );
};

export default Home;
