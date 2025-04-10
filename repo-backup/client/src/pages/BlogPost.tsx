import { useEffect, useState } from "react";
import { useRoute, Link } from "wouter";
import { ChevronLeft, Clock, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { blogPosts } from "@/data/blog-posts";
import NotFound from "./not-found";

const BlogPost = () => {
  const [, params] = useRoute("/blog/:slug");
  const [post, setPost] = useState(null);
  const [relatedPosts, setRelatedPosts] = useState([]);

  useEffect(() => {
    if (params && params.slug) {
      const foundPost = blogPosts.find((p) => p.slug === params.slug);
      setPost(foundPost);

      if (foundPost) {
        document.title = `${foundPost.title} | MehyarSoft Blog`;
        
        // Find related posts by category
        const related = blogPosts
          .filter(
            (p) => 
              p.category === foundPost.category && p.id !== foundPost.id
          )
          .slice(0, 3);
        setRelatedPosts(related);
      }
    }
  }, [params]);

  if (!post) {
    return <NotFound />;
  }

  return (
    <>
      {/* Blog Post Hero */}
      <section className="pt-28 pb-12 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto">
          <Link href="/blog">
            <Button variant="ghost" className="mb-6 text-neutral-600 dark:text-neutral-400">
              <ChevronLeft className="mr-2 h-4 w-4" /> Back to blog
            </Button>
          </Link>
          
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            {post.title}
          </h1>
          
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
          
          <div className={`px-3 py-1 rounded-full inline-block text-sm font-medium ${post.badgeColorClass} ${post.badgeBgClass}`}>
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
            className="w-full h-auto rounded-xl shadow-lg"
          />
        </div>
      </section>
      
      {/* Blog Content */}
      <section className="py-12 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-4xl">
          <div className="prose prose-lg dark:prose-invert mx-auto">
            {post.content.map((paragraph, index) => (
              <p key={index} className="mb-6 text-neutral-700 dark:text-neutral-300">
                {paragraph}
              </p>
            ))}

            {post.sections && post.sections.map((section, sectionIndex) => (
              <div key={sectionIndex} className="my-8">
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-4">
                  {section.title}
                </h2>
                {section.content.map((paragraph, paraIndex) => (
                  <p key={paraIndex} className="mb-6 text-neutral-700 dark:text-neutral-300">
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
          
          {/* Share */}
          <div className="mt-8 pt-8 border-t border-neutral-200 dark:border-neutral-800">
            <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">
              Share this article
            </h3>
            <div className="flex gap-3">
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18.2048 8.70191H15.9495V7.03194C15.9495 6.08524 16.4192 5.60747 17.8911 5.60747H18.336V2.54788C17.5193 2.42541 16.6954 2.36457 15.8703 2.36584C13.3454 2.36584 11.6359 3.88284 11.6359 6.68976V8.70191H9.33496V12.0839H11.6359V21.5H15.9495V12.0839H18.2048L18.336 8.70191Z"></path>
                </svg>
                Facebook
              </Button>
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M23 3.01a9.64 9.64 0 0 1-2.78.77 4.82 4.82 0 0 0 2.11-2.66 9.7 9.7 0 0 1-3.07 1.17A4.81 4.81 0 0 0 11.22 8 13.68 13.68 0 0 1 1.67 1.9a4.81 4.81 0 0 0 1.49 6.42 4.75 4.75 0 0 1-2.18-.6v.06a4.81 4.81 0 0 0 3.85 4.72 4.8 4.8 0 0 1-2.17.08 4.82 4.82 0 0 0 4.5 3.35 9.65 9.65 0 0 1-5.96 2.06 9.74 9.74 0 0 1-1.14-.07 13.57 13.57 0 0 0 7.36 2.16A13.67 13.67 0 0 0 21.27 6.19c0-.21 0-.42-.01-.62A9.85 9.85 0 0 0 23 3.01z"></path>
                </svg>
                Twitter
              </Button>
              <Button variant="outline" size="sm">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6.94 5.00008H2.694a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H6.94a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M6.94 13.1472H2.694a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H6.94a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M16.81 13.1472h-4.246a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H16.81a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M16.81 5.00008h-4.246a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H16.81a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M21.87 5.00008h-4.246a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H21.87a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M11.87 5.00008H7.624a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H11.87a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M11.87 13.1472H7.624a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H11.87a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                  <path d="M21.87 13.1472h-4.246a.7.7 0 0 0-.7.7v3.765a.7.7 0 0 0 .7.7H21.87a.7.7 0 0 0 .7-.7v-3.765a.7.7 0 0 0-.7-.7Z"></path>
                </svg>
                LinkedIn
              </Button>
            </div>
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
                <Link key={relatedPost.id} href={`/blog/${relatedPost.slug}`}>
                  <a className="block">
                    <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-md overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                      <img
                        src={relatedPost.image}
                        alt={relatedPost.title}
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
                  </a>
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
