import { Link } from "wouter";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";

const BlogSection = () => {
  // Get featured post and 2 recent posts
  const featuredPost = blogPosts[0];
  const recentPosts = blogPosts.slice(1, 3);

  return (
    <section id="blog" className="bg-background px-4 py-16 md:py-20">
      <div className="container mx-auto">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">
            Field notes
          </p>
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-ink dark:text-white md:text-4xl">
            Where the leaks show up first.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">
            Short posts on audits, missed-call follow-up, automation, and when to build custom software. Written from real engagements, not marketing.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Featured Blog Post */}
          <Card className="blog-card h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(8,63,84,0.10)] md:col-span-2 lg:col-span-1 lg:row-span-2">
            <img
              src={featuredPost.image}
              alt={featuredPost.title}
              className="h-56 w-full object-cover"
              loading="lazy"
            />
            <CardContent className="p-6">
              <div className="mb-3 flex items-center">
                <Badge variant="outline" className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  {featuredPost.category}
                </Badge>
                <span className="ml-3 text-xs text-muted-foreground">
                  {formatDate(featuredPost.date)}
                </span>
              </div>
              <h3 className="mb-3 text-xl font-bold tracking-[-0.02em] text-foreground">
                {featuredPost.title}
              </h3>
              <p className="mb-4 text-sm leading-6 text-muted-foreground md:text-base">
                {featuredPost.excerpt}
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Link
                  href={`/blog/${featuredPost.slug}`}
                  className={cn(
                    "inline-flex items-center font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100",
                  )}
                >
                  Read the post <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/micro-offer#intake"
                  className="inline-flex items-center text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100"
                >
                  Request the $330 audit <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Recent Blog Posts */}
          {recentPosts.map((post) => (
            <Card key={post.id} className="blog-card h-full border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_60px_rgba(8,63,84,0.10)]">
              <img
                src={post.image}
                alt={post.title}
                className="h-44 w-full object-cover"
                loading="lazy"
              />
              <CardContent className="p-6">
                <div className="mb-3 flex items-center">
                  <Badge variant="outline" className={cn("rounded-full px-3 py-1 text-xs font-medium", post.badgeBgClass, post.badgeColorClass)}>
                    {post.category}
                  </Badge>
                  <span className="ml-3 text-xs text-muted-foreground">
                    {formatDate(post.date)}
                  </span>
                </div>
                <h3 className="mb-3 text-xl font-bold tracking-[-0.02em] text-foreground">
                  {post.title}
                </h3>
                <p className="mb-4 text-sm leading-6 text-muted-foreground">
                  {post.excerpt}
                </p>
                <Link
                  href={`/blog/${post.slug}`}
                  className={cn("inline-flex items-center font-semibold hover:opacity-90", post.textColorClass)}
                >
                  Read the post <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/blog">
            <Button variant="outline" className="rounded-full border-border px-6 py-3 text-primary shadow-sm transition-colors hover:bg-secondary">
              View all articles
            </Button>
          </Link>
          <Link href="/micro-offer#intake" className="inline-flex items-center text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
            Or send the leak and request the $330 audit <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default BlogSection;