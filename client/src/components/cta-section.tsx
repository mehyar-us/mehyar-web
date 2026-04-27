import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Mail, Download } from "lucide-react";

const CTASection = () => {
  return (
    <section className="py-20 px-4 bg-gradient-to-r from-primary to-primary-dark text-white">
      <div className="container mx-auto">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-6">
            Hiring for Staff, Principal, AI Platform, or Cloud Architecture?
          </h2>
          <p className="text-xl text-white/85 mb-8 max-w-3xl mx-auto">
            I am best matched with teams that need senior technical ownership across architecture, hands-on delivery, DevOps, AI systems, production operations, and cross-functional execution.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <a href="mailto:mrswelim@gmail.com?subject=Staff%20%2F%20Principal%20Engineer%20Opportunity">
              <Button size="lg" variant="secondary" className="px-8 py-4 bg-white text-primary hover:bg-neutral-100 font-medium rounded-lg transition-colors shadow-lg hover:shadow-xl text-lg">
                <Mail className="mr-2 h-5 w-5" /> Start Hiring Conversation
              </Button>
            </a>
            <a href="/Mehyar-Swelim-Resume.txt" download>
              <Button size="lg" variant="outline" className="px-8 py-4 border-white text-white hover:bg-white hover:text-primary font-medium rounded-lg transition-colors shadow-lg hover:shadow-xl text-lg">
                <Download className="mr-2 h-5 w-5" /> Download Resume
              </Button>
            </a>
            <Link href="/portfolio">
              <Button size="lg" variant="ghost" className="px-8 py-4 text-white hover:bg-white/10 font-medium rounded-lg text-lg">
                View Proof of Work
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CTASection;
