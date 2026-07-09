import HeroSection from "@/components/hero-section";
import ServicesSection from "@/components/services-section";
import WhyChooseUs from "@/components/why-choose-us";
import TestimonialsSection from "@/components/testimonials-section";
import BlogSection from "@/components/blog-section";
import PricingSection from "@/components/pricing-section";
import ContactSection from "@/components/contact-section";
import QuickAnswer from "@/components/QuickAnswer";

const Home = () => {
  return (
    <>
      <HeroSection />
      <QuickAnswer
        question="What does MehyarSoft do?"
        answer="MehyarSoft LLC is a founder-led software, systems, and AI automation consulting firm helping local businesses, agencies, clinics, and regulated teams fix lead leaks, manual workflows, CRM gaps, and disconnected tools."
        ctaHref="/services"
        ctaLabel="See consulting offers"
      />
      <WhyChooseUs />
      <TestimonialsSection />
      <BlogSection />
      <PricingSection />
      <ContactSection />
    </>
  );
};

export default Home;