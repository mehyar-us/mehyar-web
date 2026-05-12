import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";
import QuickAnswer from "@/components/QuickAnswer";

const Blog = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredPosts = blogPosts.filter((post) => {
    const term = searchTerm.toLowerCase();
    const matchesTerm = post.title.toLowerCase().includes(term) || post.excerpt.toLowerCase().includes(term);
    const matchesCategory = selectedCategory === "all" || post.category === selectedCategory;
    return matchesTerm && matchesCategory;
  });
  const categories = ["all", ...new Set(blogPosts.map((post) => post.category))];

  return (
    <>
      <section className="border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(11,82,104,0.12),transparent_32%),linear-gradient(135deg,hsl(var(--brand-100))_0%,hsl(var(--background))_56%,#fff_100%)] px-4 pb-14 pt-28 dark:bg-[radial-gradient(circle_at_top_left,rgba(143,211,221,0.10),transparent_32%),linear-gradient(135deg,hsl(var(--brand-900))_0%,hsl(var(--background))_56%,hsl(var(--brand-950))_100%)] md:pt-32">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.75fr] lg:items-end">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-brand-700 dark:text-brand-100">Blog and insights</p>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-ink dark:text-white md:text-6xl md:leading-[0.98]">Practical notes for owners who need fewer leaks.</h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground md:text-lg md:leading-8">Local business tech audits, CRM follow-up, automation, and when custom software is worth it — written to move readers toward a practical next step.</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-card/88 p-4 shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
            <label htmlFor="blog-search" className="mb-2 block text-sm font-semibold text-foreground">Search articles</label>
            <Input id="blog-search" type="search" placeholder="Search by problem or tool..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
          </div>
        </div>
      </section>

      <QuickAnswer
        question="What does the MehyarSoft blog cover?"
        answer="The MehyarSoft blog covers practical guidance on finding revenue leaks, improving CRM and missed-call follow-up, deciding when to automate, and scoping custom software safely."
        ctaHref="/contact"
        ctaLabel="Turn an article into an audit"
      />

      <section className="bg-background px-4 py-16 md:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-8 flex flex-wrap gap-2">
              {categories.map((category) => (
                <Button key={category} variant={selectedCategory === category ? "default" : "outline"} size="sm" className="capitalize" onClick={() => setSelectedCategory(category)}>
                  {category}
                </Button>
              ))}
            </div>

            {filteredPosts.length > 0 ? (
              <div className="space-y-5">
                {filteredPosts.map((post, index) => (
                  <Card key={post.id} className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)] transition hover:border-brand-700/35">
                    <CardContent className="grid gap-5 p-6 md:grid-cols-[72px_1fr]">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-brand-800 dark:bg-white/10 dark:text-brand-100">
                        <BookOpen aria-hidden="true" size={24} />
                      </div>
                      <div>
                        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          <span className="rounded-full border border-border px-3 py-1">{post.category}</span>
                          <span>{formatDate(post.date)}</span>
                        </div>
                        <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground">{post.title}</h2>
                        <p className="mt-3 leading-7 text-muted-foreground">{post.excerpt}</p>
                        <Link href={`/blog/${post.slug}`} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-brand-800 hover:text-brand-700 dark:text-brand-100">
                          Read article <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Link>
                        {index === 1 ? (
                          <div className="mt-5 rounded-2xl border border-brand-700/20 bg-secondary/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                            <p className="text-sm font-semibold text-foreground">Need this applied to your business?</p>
                            <Link href="/contact" className="mt-2 inline-flex text-sm font-semibold text-brand-800 dark:text-brand-100">Book a Tech Audit →</Link>
                          </div>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-border bg-card p-8 text-center">
                <p className="text-lg text-muted-foreground">No articles found matching your search criteria.</p>
                <Button variant="outline" className="mt-4" onClick={() => { setSearchTerm(""); setSelectedCategory("all"); }}>Clear filters</Button>
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <Card className="border-border bg-card shadow-[0_1px_2px_rgba(10,20,24,0.06)]">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">Popular articles</h3>
                <div className="mt-5 space-y-4">
                  {blogPosts.slice(0, 4).map((post) => (
                    <Link key={post.id} href={`/blog/${post.slug}`} className="block rounded-xl border border-border bg-background/70 p-3 text-sm font-semibold leading-5 text-foreground hover:text-brand-800 dark:hover:text-brand-100">
                      {post.title}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">{formatDate(post.date)}</span>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="border-brand-700/20 bg-secondary/80 shadow-[0_1px_2px_rgba(10,20,24,0.06)] dark:border-white/10 dark:bg-white/[0.04]">
              <CardContent className="p-6">
                <h3 className="text-xl font-bold tracking-[-0.02em] text-foreground">Need a practical next step?</h3>
                <p className="mt-3 leading-7 text-muted-foreground">Turn one article topic into an audit, cleanup, automation, or support conversation.</p>
                <Link href="/contact" className={buttonVariants({ variant: "cta", className: "mt-5 w-full" })}>
                  Book a Tech Audit
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      </section>
    </>
  );
};

export default Blog;
