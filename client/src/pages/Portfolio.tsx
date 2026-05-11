import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { projects } from "@/data/portfolio-projects";
import CTASection from "@/components/cta-section";

const Portfolio = () => {
  const [filter, setFilter] = useState("all");
  const [filteredProjects, setFilteredProjects] = useState(projects);

  useEffect(() => {
    document.title = "Portfolio | MehyarSoft";
    
    if (filter === "all") {
      setFilteredProjects(projects);
    } else {
      setFilteredProjects(
        projects.filter((project) => project.category === filter)
      );
    }
  }, [filter]);

  const categories = ["all", ...new Set(projects.map((p) => p.category))];

  return (
    <>
      {/* Portfolio Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Our Portfolio
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto mb-8">
            Explore our collection of successful projects across different
            industries and technologies.
          </p>
        </div>
      </section>

      {/* Portfolio Filters and Grid */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          {/* Filters */}
          <div className="flex flex-wrap justify-center gap-2 mb-12">
            {categories.map((category) => (
              <Button
                key={category}
                variant={filter === category ? "default" : "outline"}
                className="capitalize"
                onClick={() => setFilter(category)}
              >
                {category}
              </Button>
            ))}
          </div>

          {/* Projects Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredProjects.map((project) => (
              <Card
                key={project.id}
                className="bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:shadow-xl"
              >
                <img
                  src={project.image}
                  alt={project.title}
                  className="w-full h-48 object-cover"
                />
                <CardContent className="p-6">
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium ${project.badgeColorClass} ${project.badgeBgClass} px-3 py-1 rounded-full`}
                  >
                    {project.category}
                  </Badge>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mt-3 mb-2">
                    {project.title}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                    {project.description}
                  </p>
                  <Link href={`/portfolio/${project.id}`}>
                    <a
                      className={`inline-flex items-center ${project.textColorClass} hover:${project.hoverColorClass} font-medium transition-colors`}
                    >
                      View case study <ChevronRight className="ml-2 h-4 w-4" />
                    </a>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredProjects.length === 0 && (
            <div className="text-center py-12">
              <p className="text-lg text-neutral-700 dark:text-neutral-300">
                No projects found for this category.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setFilter("all")}
              >
                Show all projects
              </Button>
            </div>
          )}
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default Portfolio;
