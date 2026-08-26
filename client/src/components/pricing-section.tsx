import IndustryPricingExplorer from "@/components/industry-pricing-explorer";

const PricingSection = () => {
  return (
    <section
      id="pricing"
      className="border-y border-border bg-secondary/55 dark:bg-brand-950"
    >
      <IndustryPricingExplorer />
    </section>
  );
};

export default PricingSection;
