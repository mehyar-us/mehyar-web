import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";

const BlogSection = () => {
  // Get featured post and 2 recent posts
  const featuredPost = blogPosts[0];
  const recentPosts = blogPosts.slice(1, 3);

  return (
    <section id="blog" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Latest Insights
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Stay updated with our latest thoughts on technology, business, and
            industry trends.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Featured Blog Post */}
          <Card className="blog-card bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden md:col-span-2 lg:col-span-1 lg:row-span-2 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl">
            <img
              src={featuredPost.image}
              alt={featuredPost.title}
              className="w-full h-64 object-cover"
            />
            <CardContent className="p-6">
              <div className="flex items-center mb-3">
                <Badge variant="outline" className="text-xs font-medium text-primary bg-primary/10 px-3 py-1 rounded-full">
                  {featuredPost.category}
                </Badge>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-3">
                  {formatDate(featuredPost.date)}
                </span>
              </div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
                {featuredPost.title}
              </h3>
              <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                {featuredPost.excerpt}
              </p>
              <Link href={`/blog/${featuredPost.slug}`}>
                <a className="inline-flex items-center text-primary hover:text-primary-dark dark:hover:text-primary-light font-medium transition-colors">
                  Read more <ChevronRight className="ml-2 h-4 w-4" />
                </a>
              </Link>
            </CardContent>
          </Card>

          {/* Recent Blog Posts */}
          {recentPosts.map((post) => (
            <Card key={post.id} className="blog-card bg-white dark:bg-neutral-800 rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:-translate-y-2 hover:shadow-xl">
              <img
                src={post.image}
                alt={post.title}
                className="w-full h-48 object-cover"
              />
              <CardContent className="p-6">
                <div className="flex items-center mb-3">
                  <Badge variant="outline" className={`text-xs font-medium ${post.badgeColorClass} ${post.badgeBgClass} px-3 py-1 rounded-full`}>
                    {post.category}
                  </Badge>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-3">
                    {formatDate(post.date)}
                  </span>
                </div>
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
                  {post.title}
                </h3>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">
                  {post.excerpt}
                </p>
                <Link href={`/blog/${post.slug}`}>
                  <a className={`inline-flex items-center ${post.textColorClass} hover:${post.hoverColorClass} font-medium transition-colors`}>
                    Read more <ChevronRight className="ml-2 h-4 w-4" />
                  </a>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center mt-12">
          <Link href="/blog">
            <Button variant="outline" className="px-6 py-3 bg-white dark:bg-neutral-800 text-primary font-medium rounded-lg transition-colors shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700">
              View All Articles
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default BlogSection;
