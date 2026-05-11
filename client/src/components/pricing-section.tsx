import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const offers = [
  { name: "Local Business Tech Audit", price: "$150-$500", fit: "Restaurants, clinics, stores, salons, service businesses", outcome: "A prioritized leak map and practical action plan." },
  { name: "Website / Booking Cleanup", price: "$750-$2,500", fit: "Owners with traffic or referrals but weak conversion", outcome: "Clear offer pages, intake, CTAs, and booking path." },
  { name: "AI Follow-Up Flow", price: "$1,500-$5,000", fit: "Missed calls, slow responses, no-shows, unworked leads", outcome: "SMS/email/CRM follow-up with consent-safe rules." },
  { name: "Internal Automation Sprint", price: "$3,000-$12,000", fit: "Teams buried in spreadsheets, inboxes, and recurring admin", outcome: "One workflow automated and documented." },
  { name: "Architecture / Integration Consulting", price: "$100-$175/hr or $5k-$25k/project", fit: "Pharma, healthcare, SaaS, agencies, regulated teams", outcome: "Senior systems support for safe, reliable integrations." },
  { name: "Monthly Support Retainer", price: "$500-$3,500/mo", fit: "Businesses needing ongoing technical ownership", outcome: "Website, CRM, automation, and reporting support." },
];

const PricingSection = () => {
  return (
    <section id="pricing" className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Offer ladder and starting ranges
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Pricing depends on scope, risk, integrations, and urgency. The goal is to start at the right level,
            prove value quickly, and only expand when the business case is clear.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {offers.map((offer) => (
            <Card key={offer.name} className="bg-white dark:bg-neutral-900 shadow-md h-full">
              <CardContent className="p-6 flex flex-col h-full">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">{offer.name}</h3>
                <p className="text-2xl font-bold text-primary mb-4">{offer.price}</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-3"><strong>Best fit:</strong> {offer.fit}</p>
                <p className="text-neutral-700 dark:text-neutral-300 mb-6 flex-grow"><strong>Outcome:</strong> {offer.outcome}</p>
                <Link href="/contact">
                  <Button variant="outline" className="w-full">Ask about this offer</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <p className="text-center text-sm text-neutral-600 dark:text-neutral-400 mt-8">
          Local phone/electronics help may be available for $50-$250/job when it is the fastest path to a relationship or referral.
        </p>
      </div>
    </section>
  );
};

export default PricingSection;
