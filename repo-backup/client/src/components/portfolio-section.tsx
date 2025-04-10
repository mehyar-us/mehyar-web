import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { projects } from "@/data/portfolio-projects";

const PortfolioSection = () => {
  // Only show first 3 projects in preview section
  const previewProjects = projects.slice(0, 3);

  return (
    <section id="portfolio" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Our Work
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Explore our portfolio of successful projects across different industries and technologies.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {previewProjects.map((project) => (
            <Card key={project.id} className="bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden">
              <img 
                src={project.image}
                alt={project.title} 
                className="w-full h-48 object-cover"
              />
              <CardContent className="p-6">
                <Badge variant="outline" className={`text-xs font-medium ${project.badgeColorClass} ${project.badgeBgClass} px-3 py-1 rounded-full`}>
                  {project.category}
                </Badge>
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mt-3 mb-2">
                  {project.title}
                </h3>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                  {project.description}
                </p>
                <Link href={`/portfolio/${project.id}`}>
                  <a className={`inline-flex items-center ${project.textColorClass} hover:${project.hoverColorClass} font-medium transition-colors`}>
                    View case study <ChevronRight className="ml-2 h-4 w-4" />
                  </a>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link href="/portfolio">
            <Button variant="outline" className="px-6 py-3 bg-white dark:bg-neutral-800 text-primary font-medium rounded-lg transition-colors shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700">
              View All Projects
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PortfolioSection;
