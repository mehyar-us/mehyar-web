import HeroSection from "@/components/hero-section";
import HomeSolutionsOverview from "@/components/HomeSolutionsOverview";
import HomeIndustryFinder from "@/components/HomeIndustryFinder";
import MaintenanceSupportSection from "@/components/maintenance-support-section";
import HomeCtaSection from "@/components/HomeCtaSection";

const Home = () => {
  return (
    <>
      <HeroSection />
      <HomeSolutionsOverview />
      <HomeIndustryFinder />
      <MaintenanceSupportSection compact />
      <HomeCtaSection />
    </>
  );
};

export default Home;
