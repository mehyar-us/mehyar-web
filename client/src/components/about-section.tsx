import { Card, CardContent } from "@/components/ui/card";

const proofPoints = [
  { metric: "AWS", label: "ECS, Lambda, RDS, S3, API Gateway, CDK, Terraform" },
  { metric: "AI", label: "OpenAI, Gemini, Deepgram, ElevenLabs, RAG, Pinecone" },
  { metric: "Data", label: "PostgreSQL, MySQL, DynamoDB, Snowflake, analytics pipelines" },
  { metric: "Scale", label: "Millions of API requests/day and hundreds of millions of events/month" },
];

const AboutSection = () => {
  return (
    <section id="about" className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
              Senior technical operator for teams that need architecture ownership, not another ticket-taker.
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-4">
              I am a staff-level engineer with 15+ years owning full-stack, cloud, DevOps, data, and AI-driven systems from requirements through production operations.
            </p>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
              My strongest value is working across the full lifecycle: architecture, build, integration, deployment, observability, incident resolution, documentation, stakeholder communication, and long-term platform modernization.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
              {proofPoints.map((item) => (
                <Card key={item.metric} className="bg-white dark:bg-neutral-900 shadow-sm border-neutral-200 dark:border-neutral-700">
                  <CardContent className="p-5">
                    <div className="text-primary font-bold text-2xl mb-1">{item.metric}</div>
                    <div className="text-neutral-700 dark:text-neutral-300 text-sm">{item.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div className="rounded-3xl bg-white dark:bg-neutral-900 shadow-xl border border-neutral-200 dark:border-neutral-700 p-8">
            <h3 className="text-2xl font-bold text-neutral-900 dark:text-white mb-6">Recent impact</h3>
            <div className="space-y-5">
              <div>
                <p className="font-semibold text-neutral-900 dark:text-white">Shionogi · Staff Commercial Systems Engineer</p>
                <p className="text-neutral-700 dark:text-neutral-300">Architecture, technical leadership, solution design reviews, regulated documentation, vendor delivery, and production support for pharmaceutical commercial systems.</p>
              </div>
              <div>
                <p className="font-semibold text-neutral-900 dark:text-white">Foragr.ai · Staff Software Engineer</p>
                <p className="text-neutral-700 dark:text-neutral-300">Delivered voice AI pipeline using Deepgram, OpenAI/Gemini, RAG, ElevenLabs, Pinecone, PostgreSQL, and tool-calling workflows.</p>
              </div>
              <div>
                <p className="font-semibold text-neutral-900 dark:text-white">PMC Analytics · Senior Staff Software Engineer</p>
                <p className="text-neutral-700 dark:text-neutral-300">Re-architected analytics platform with Django REST, React/TypeScript, AWS CDK, GitHub Actions, and CodeBuild blue-green deployments.</p>
              </div>
              <div>
                <p className="font-semibold text-neutral-900 dark:text-white">StringFlix · Co-Founder / CTO</p>
                <p className="text-neutral-700 dark:text-neutral-300">Architected and scaled a multi-tenant video platform to 100K+ users with 99.95% uptime on AWS and Kubernetes/EKS.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
