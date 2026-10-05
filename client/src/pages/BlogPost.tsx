import { useRoute, Link } from "wouter";
import { ChevronLeft, Clock, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";
import NotFound from "./not-found";
import QuickAnswer from "@/components/QuickAnswer";
import NewsletterSignup from "@/components/NewsletterSignup";

const quickAnswers: Record<string, { question: string; answer: string }> = {
  "small-business-tech-audit-revenue-leaks": {
    question: "What is a small business tech audit?",
    answer:
      "A small business tech audit is a practical review of the website, booking path, phone and email response, CRM or spreadsheet use, and manual work that may be leaking revenue before the owner buys more software.",
  },
  "missed-calls-crm-follow-up": {
    question: "Why are missed calls a CRM problem?",
    answer:
      "Missed calls become a CRM problem when inbound intent is not captured, assigned, followed up, or measured. The fix is a consent-aware response workflow with owner visibility, suppression handling, and clear routing.",
  },
  "when-to-build-custom-software": {
    question: "When is custom software justified?",
    answer:
      "Custom software is justified when the workflow is important, repeated, stable enough to encode, and constrained by SaaS tools that create copy-paste work, access problems, or unreliable handoffs.",
  },
};

const BlogPost = () => {
  const [, params] = useRoute("/blog/:slug");
  const post = blogPosts.find((p) => p.slug === params?.slug);
  const relatedPosts = post
    ? blogPosts
        .filter((p) => p.category === post.category && p.id !== post.id)
        .slice(0, 3)
    : [];

  if (!post) {
    return <NotFound />;
  }

  const quickAnswer = quickAnswers[post.slug];

  return (
    <>
      {/* Blog Post Hero */}
      <section className="site-hero">
        <div className="site-shell">
          <Link href="/blog">
            <Button
              variant="ghost"
              className="mb-6 text-neutral-600 dark:text-neutral-400"
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Back to blog
            </Button>
          </Link>

          <h1 className="site-display mb-6">{post.title}</h1>
          <Link
            className="inline-flex min-h-11 items-center underline mb-5"
            href={`/explore?topic=${encodeURIComponent(post.title)}`}
          >
            Explore this topic with AI →
          </Link>

          <div className="flex flex-wrap items-center text-sm text-neutral-600 dark:text-neutral-400 gap-4 md:gap-6 mb-6">
            <div className="flex items-center">
              <User className="mr-2 h-4 w-4" /> {post.author}
            </div>
            <div className="flex items-center">
              <Calendar className="mr-2 h-4 w-4" /> {formatDate(post.date)}
            </div>
            <div className="flex items-center">
              <Clock className="mr-2 h-4 w-4" /> {post.readTime} min read
            </div>
          </div>

          <div
            className={`px-3 py-1 rounded-full inline-block text-sm font-medium ${post.badgeColorClass} ${post.badgeBgClass}`}
          >
            {post.category}
          </div>
        </div>
      </section>

      {/* Featured Image */}
      <section className="py-8 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-4xl">
          <img
            src={post.image}
            alt={post.title}
            width="1200"
            height="630"
            className="site-media h-auto w-full shadow-lg"
          />
        </div>
      </section>
      {quickAnswer ? (
        <QuickAnswer
          question={quickAnswer.question}
          answer={quickAnswer.answer}
          ctaHref="/contact"
          ctaLabel="Discuss your business"
        />
      ) : null}

      {/* Blog Content */}
      <section className="py-12 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-4xl">
          <div className="prose prose-lg dark:prose-invert mx-auto">
            {post.content.map((paragraph, index) => (
              <p
                key={index}
                className="mb-6 text-neutral-700 dark:text-neutral-300"
              >
                {paragraph}
              </p>
            ))}

            {post.sections &&
              post.sections.map((section, sectionIndex) => (
                <div key={sectionIndex} className="my-8">
                  <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
                    {section.title}
                  </h2>
                  {section.content.map((paragraph, paraIndex) => (
                    <p
                      key={paraIndex}
                      className="mb-6 text-neutral-700 dark:text-neutral-300"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              ))}
          </div>

          {/* Tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="mt-12 flex flex-wrap gap-2">
              {post.tags.map((tag, index) => (
                <span
                  key={index}
                  className="px-3 py-1 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-full text-sm"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <div className="mx-auto mt-10 max-w-3xl">
            <NewsletterSignup
              variant="inline"
              source={`blog_post_${post.slug}`}
              title="Get the free checklist behind this advice."
              description="Use it to spot missed-call, website, CRM, and manual-work leaks in your own business before requesting a paid audit."
            />
          </div>

          {/* Share */}
          <div className="mt-8 pt-8 border-t border-neutral-200 dark:border-neutral-800">
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
              Share this article
            </h3>
            <div className="flex gap-3"></div>
          </div>
        </div>
      </section>

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="py-12 px-4 bg-neutral-50 dark:bg-neutral-800">
          <div className="container mx-auto max-w-6xl">
            <h3 className="text-2xl font-bold text-neutral-900 dark:text-white mb-6">
              Related Articles
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {relatedPosts.map((relatedPost) => (
                <Link
                  key={relatedPost.id}
                  href={`/blog/${relatedPost.slug}`}
                  className="block"
                >
                  <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                    <img
                      src={relatedPost.image}
                      alt={relatedPost.title}
                      width="640"
                      height="360"
                      loading="lazy"
                      className="w-full h-48 object-cover"
                    />
                    <div className="p-4">
                      <h4 className="font-bold text-neutral-900 dark:text-white mb-2">
                        {relatedPost.title}
                      </h4>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">
                        {formatDate(relatedPost.date)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
};

export default BlogPost;
