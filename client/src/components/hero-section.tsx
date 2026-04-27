import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Mail, Linkedin } from "lucide-react";

const HeroSection = () => {
  return (
    <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/10 via-white to-secondary/10 dark:from-primary/10 dark:via-neutral-950 dark:to-secondary/10">
      <div className="container mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex flex-wrap gap-2 mb-6">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Available for Staff / Principal roles</Badge>
              <Badge variant="outline">Brooklyn, NY · Remote / Hybrid</Badge>
              <Badge variant="outline">English / Arabic</Badge>
            </div>
            <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-5 text-neutral-900 dark:text-white">
              Staff Software Engineer for{" "}
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                AI, Cloud & Platform Architecture
              </span>
            </h1>
            <p className="text-lg md:text-xl text-neutral-700 dark:text-neutral-300 mb-8 max-w-2xl">
              I build and modernize production systems end-to-end: full-stack applications, AWS infrastructure, DevOps pipelines, RAG/LLM platforms, data integrations, and scalable architecture for regulated and high-growth teams.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="rounded-xl bg-white dark:bg-neutral-900 p-4 shadow-sm border border-neutral-200 dark:border-neutral-800">
                <div className="text-3xl font-bold text-primary">15+</div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">Years engineering</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-900 p-4 shadow-sm border border-neutral-200 dark:border-neutral-800">
                <div className="text-3xl font-bold text-primary">100K+</div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">Users scaled</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-900 p-4 shadow-sm border border-neutral-200 dark:border-neutral-800">
                <div className="text-3xl font-bold text-primary">99.95%</div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">Platform uptime</div>
              </div>
              <div className="rounded-xl bg-white dark:bg-neutral-900 p-4 shadow-sm border border-neutral-200 dark:border-neutral-800">
                <div className="text-3xl font-bold text-primary">40%</div>
                <div className="text-sm text-neutral-600 dark:text-neutral-300">Reporting work reduced</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <a href="mailto:mrswelim@gmail.com?subject=Staff%20%2F%20Principal%20Engineer%20Opportunity">
                <Button size="lg" className="px-6 py-3 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-md hover:shadow-lg">
                  <Mail className="mr-2 h-5 w-5" /> Contact Mehyar
                </Button>
              </a>
              <a href="/Mehyar-Swelim-Resume.txt" download>
                <Button variant="outline" size="lg" className="px-6 py-3 bg-white hover:bg-neutral-100 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-primary dark:text-white font-medium rounded-lg shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700">
                  <Download className="mr-2 h-5 w-5" /> Download Resume
                </Button>
              </a>
              <a href="https://www.linkedin.com/in/mehyarswelim" target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="lg" className="px-6 py-3 font-medium rounded-lg">
                  <Linkedin className="mr-2 h-5 w-5" /> LinkedIn
                </Button>
              </a>
            </div>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-gradient-to-br from-primary/20 to-secondary/20 blur-2xl" />
            <div className="relative rounded-3xl bg-white dark:bg-neutral-900 shadow-2xl border border-neutral-200 dark:border-neutral-800 p-8">
              <img
                src="/mehyar-swelim.jpg"
                alt="Mehyar Swelim, Staff Software Engineer"
                className="w-32 h-32 rounded-2xl object-cover mb-6 shadow-lg"
              />
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">Mehyar Swelim</h2>
              <p className="text-primary font-semibold mb-4">Staff Software Engineer · Full-Stack, DevOps & AI Systems</p>
              <div className="space-y-3 text-neutral-700 dark:text-neutral-300">
                <p>• AWS-certified architect/developer/operator</p>
                <p>• RAG, LLM, voice AI, Pinecone, PostgreSQL</p>
                <p>• React, TypeScript, Python, Django, FastAPI, Node.js</p>
                <p>• Kubernetes/EKS, Docker, CDK, Terraform, GitHub Actions</p>
              </div>
              <div className="mt-6 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                <p className="text-sm font-medium text-neutral-900 dark:text-white">Best-fit roles</p>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">Staff Engineer · Principal Engineer · AI Platform Engineer · Cloud / Solutions Architect · Hands-on Engineering Lead</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
