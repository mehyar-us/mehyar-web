import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";

const Blog = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredPosts, setFilteredPosts] = useState(blogPosts);
  const [selectedCategory, setSelectedCategory] = useState("all");

  useEffect(() => {
    document.title = "Blog | MehyarSoft";
    
    // Filter posts based on search term and category
    const results = blogPosts.filter((post) => {
      const matchesTerm = post.title
        .toLowerCase()
        .includes(searchTerm.toLowerCase()) 
        || post.excerpt
            .toLowerCase()
            .includes(searchTerm.toLowerCase());
            
      const matchesCategory = 
        selectedCategory === "all" || post.category === selectedCategory;
        
      return matchesTerm && matchesCategory;
    });
    
    setFilteredPosts(results);
  }, [searchTerm, selectedCategory]);

  // Extract unique categories
  const categories = ["all", ...new Set(blogPosts.map((post) => post.category))];

  return (
    <>
      {/* Blog Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Blog & Insights
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto mb-8">
            Explore our latest articles, guides, and industry insights.
          </p>
          
          <div className="max-w-xl mx-auto">
            <Input
              type="search"
              placeholder="Search articles..."
              className="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* Blog Content */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="flex flex-col lg:flex-row gap-12">
            {/* Main Content */}
            <div className="lg:w-2/3">
              <div className="flex flex-wrap gap-2 mb-8">
                {categories.map((category) => (
                  <Button
                    key={category}
                    variant={selectedCategory === category ? "default" : "outline"}
                    size="sm"
                    className="capitalize"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </Button>
                ))}
              </div>

              {filteredPosts.length > 0 ? (
                <div className="space-y-8">
                  {filteredPosts.map((post) => (
                    <Card key={post.id} className="bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
                      <div className="flex flex-col md:flex-row">
                        <div className="md:w-1/3">
                          <img
                            src={post.image}
                            alt={post.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="md:w-2/3 p-6">
                          <div className="flex items-center mb-3">
                            <Badge
                              variant="outline"
                              className={`text-xs font-medium ${post.badgeColorClass} ${post.badgeBgClass} px-3 py-1 rounded-full`}
                            >
                              {post.category}
                            </Badge>
                            <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-3">
                              {formatDate(post.date)}
                            </span>
                          </div>
                          <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
                            {post.title}
                          </h2>
                          <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                            {post.excerpt}
                          </p>
                          <Link href={`/blog/${post.slug}`}>
                            <a className={`inline-flex items-center ${post.textColorClass} hover:${post.hoverColorClass} font-medium transition-colors`}>
                              Read more <ChevronRight className="ml-2 h-4 w-4" />
                            </a>
                          </Link>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <p className="text-lg text-neutral-700 dark:text-neutral-300">
                    No articles found matching your search criteria.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => {
                      setSearchTerm("");
                      setSelectedCategory("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:w-1/3 space-y-8">
              <Card className="bg-white dark:bg-neutral-800 rounded-xl shadow-md overflow-hidden">
                <CardContent className="p-6">
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
                    Popular Articles
                  </h3>
                  <div className="space-y-4">
                    {blogPosts.slice(0, 4).map((post) => (
                      <div key={post.id} className="flex gap-3">
                        <img
                          src={post.image}
                          alt={post.title}
                          className="w-16 h-16 object-cover rounded-md"
                        />
                        <div>
                          <h4 className="font-medium text-neutral-900 dark:text-white text-sm line-clamp-2">
                            <Link href={`/blog/${post.slug}`}>
                              <a className="hover:text-primary">{post.title}</a>
                            </Link>
                          </h4>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {formatDate(post.date)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-primary/5 dark:bg-primary/10 rounded-xl shadow-md overflow-hidden">
                <CardContent className="p-6">
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
                    Subscribe to Our Newsletter
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                    Get the latest insights delivered directly to your inbox.
                  </p>
                  <form className="space-y-4">
                    <Input
                      type="email"
                      placeholder="Your email address"
                      className="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800"
                    />
                    <Button className="w-full">Subscribe</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Blog;
