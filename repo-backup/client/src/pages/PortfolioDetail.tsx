import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { projects, PortfolioProject } from "@/data/portfolio-projects";
import CTASection from "@/components/cta-section";

const PortfolioDetail = () => {
  const [, params] = useRoute("/portfolio/:id");
  const [project, setProject] = useState<PortfolioProject | null>(null);

  useEffect(() => {
    // Find project by ID
    const id = parseInt(params?.id || "0", 10);
    const foundProject = projects.find((p) => p.id === id);
    
    if (foundProject) {
      setProject(foundProject);
      document.title = `${foundProject.title} | MehyarSoft Portfolio`;
    }
  }, [params]);

  if (!project) {
    return (
      <div className="pt-32 pb-20 px-4 bg-white dark:bg-neutral-900 min-h-screen">
        <div className="container mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
            Project Not Found
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto mb-8">
            The project you're looking for doesn't exist or has been removed.
          </p>
          <Link href="/portfolio">
            <Button>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Portfolio
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Project Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto">
          <Link href="/portfolio">
            <a className="inline-flex items-center text-neutral-600 dark:text-neutral-400 hover:text-primary dark:hover:text-primary mb-8 transition-colors">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Portfolio
            </a>
          </Link>
          
          <div className="flex flex-col md:flex-row gap-8 md:gap-16">
            <div className="md:w-3/5">
              <Badge
                variant="outline"
                className={`text-sm font-medium ${project.badgeColorClass} ${project.badgeBgClass} px-3 py-1 rounded-full mb-4`}
              >
                {project.category}
              </Badge>
              <h1 className="text-3xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
                {project.title}
              </h1>
              <p className="text-xl text-neutral-700 dark:text-neutral-300 mb-8">
                {project.description}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                    Client
                  </h3>
                  <p className="text-neutral-900 dark:text-white font-medium">
                    {project.client}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                    Year
                  </h3>
                  <p className="text-neutral-900 dark:text-white font-medium">
                    {project.year}
                  </p>
                </div>
              </div>
            </div>
            <div className="md:w-2/5">
              <div className="aspect-video overflow-hidden rounded-xl shadow-lg">
                <img
                  src={project.detailImage || project.image}
                  alt={project.title}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Project Details */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            <div className="lg:col-span-2 space-y-12">
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
                  The Challenge
                </h2>
                <p className="text-neutral-700 dark:text-neutral-300 leading-relaxed">
                  {project.challenge}
                </p>
              </div>
              
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
                  Our Solution
                </h2>
                <p className="text-neutral-700 dark:text-neutral-300 leading-relaxed">
                  {project.solution}
                </p>
              </div>
              
              <div>
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
                  The Results
                </h2>
                <ul className="space-y-3">
                  {project.results.map((result, index) => (
                    <li key={index} className="flex items-start">
                      <span className={`mr-3 h-6 w-6 flex-shrink-0 rounded-full ${project.badgeBgClass} flex items-center justify-center`}>
                        <Check className={`h-4 w-4 ${project.textColorClass}`} />
                      </span>
                      <span className="text-neutral-700 dark:text-neutral-300">{result}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            
            <div className="space-y-8">
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
                  Technologies Used
                </h3>
                <div className="flex flex-wrap gap-2">
                  {project.technologies.map((tech, index) => (
                    <Badge key={index} variant="secondary" className="text-sm px-3 py-1">
                      {tech}
                    </Badge>
                  ))}
                </div>
              </div>
              
              <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-6">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
                  Explore More Projects
                </h3>
                <div className="space-y-4">
                  {projects
                    .filter(p => p.id !== project.id)
                    .slice(0, 3)
                    .map(p => (
                      <div key={p.id} className="flex items-center gap-3">
                        <div className="w-16 h-12 rounded-md overflow-hidden flex-shrink-0">
                          <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
                        </div>
                        <div>
                          <Link href={`/portfolio/${p.id}`}>
                            <a className="font-medium text-neutral-900 dark:text-white hover:text-primary dark:hover:text-primary transition-colors">
                              {p.title}
                            </a>
                          </Link>
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                            {p.category}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
                <Separator className="my-4" />
                <Link href="/portfolio">
                  <Button variant="outline" size="sm" className="w-full">
                    View All Projects
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default PortfolioDetail;