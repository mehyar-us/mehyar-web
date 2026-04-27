import { useEffect } from "react";
import { Link } from "wouter";
import { CheckCircle, Award, Users, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import CTASection from "@/components/cta-section";

const About = () => {
  useEffect(() => {
    document.title = "About Mehyar Swelim | Staff Software Engineer";
  }, []);

  const values = [
    { title: "Architecture ownership", description: "Senior system design paired with hands-on implementation and production accountability.", icon: <Award className="h-6 w-6 text-primary" /> },
    { title: "Execution quality", description: "Clean delivery habits: documentation, reviews, testing, observability, troubleshooting, and handoff.", icon: <CheckCircle className="h-6 w-6 text-primary" /> },
    { title: "Cross-functional leadership", description: "Comfortable working with engineering, product, agencies, vendors, IT, support, and business stakeholders.", icon: <Users className="h-6 w-6 text-primary" /> },
    { title: "Speed with reliability", description: "Bias toward shortening release cycles without losing operational discipline or compliance awareness.", icon: <Clock className="h-6 w-6 text-primary" /> },
  ];

  const timeline = [
    { year: "2025", title: "Shionogi · Staff Commercial Systems Engineer", description: "Architecture leadership, production support, regulated documentation, solution design reviews, and vendor delivery for pharmaceutical commercial systems." },
    { year: "2025", title: "Foragr.ai · Staff Software Engineer", description: "Built AI voice assistant architecture using Deepgram, OpenAI/Gemini, RAG, Pinecone, PostgreSQL, ElevenLabs, and tool-calling workflows." },
    { year: "2023-2025", title: "PMC Analytics · Senior Staff Software Engineer", description: "Owned analytics platform re-architecture with Django REST, React/TypeScript, AWS CDK, GitHub Actions, CodeBuild, Docker, and blue-green releases." },
    { year: "2019-2023", title: "StringFlix · Co-Founder / CTO", description: "Scaled multi-tenant video platform to 100K+ users with 99.95% uptime on AWS and Kubernetes/EKS." },
    { year: "2018-2023", title: "What If Media Group · Software Engineer II", description: "Built high-throughput marketing APIs, 50+ integrations, Snowflake/DynamoDB data pipelines, and systems handling millions of requests/day." },
  ];

  return (
    <>
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="md:w-1/2">
              <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">About Mehyar Swelim</h1>
              <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
                Staff Software Engineer with 15+ years across full-stack systems, AWS cloud architecture, DevOps, AI/LLM platforms, data integrations, and regulated production environments.
              </p>
              <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-8">
                I am strongest where companies need someone who can own ambiguous technical problems, design the right architecture, align stakeholders, and ship reliable systems.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/contact"><Button className="px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg">Contact Mehyar</Button></Link>
                <a href="/Mehyar-Swelim-Resume.txt" download><Button variant="outline" className="px-6 py-3">Download Resume</Button></a>
              </div>
            </div>
            <div className="md:w-1/2">
              <img src="/mehyar-swelim.jpg" alt="Mehyar Swelim" className="rounded-3xl shadow-xl w-full object-cover max-h-[520px]" />
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">Operating strengths</h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">What hiring teams get beyond raw coding ability.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {values.map((value) => (
              <Card key={value.title} className="bg-white dark:bg-neutral-900 shadow-md h-full border-neutral-200 dark:border-neutral-700">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4">{value.icon}</div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">{value.title}</h3>
                  <p className="text-neutral-700 dark:text-neutral-300">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">Career proof line</h2>
          </div>
          <div className="max-w-4xl mx-auto">
            {timeline.map((item) => (
              <div key={item.title} className="flex flex-col md:flex-row mb-12 last:mb-0">
                <div className="md:w-1/4 mb-4 md:mb-0"><div className="bg-primary text-white text-xl font-bold rounded-lg px-4 py-2 inline-block">{item.year}</div></div>
                <div className="md:w-3/4"><h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">{item.title}</h3><p className="text-neutral-700 dark:text-neutral-300">{item.description}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default About;
