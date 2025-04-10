import { useEffect } from "react";
import { Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact Us | MehyarSoft";
  }, []);

  const handleEmailClick = () => {
    window.location.href = "mailto:info@mehyar.us";
  };

  return (
    <>
      {/* Contact Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Get in Touch
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Have a question or ready to start your project? We'd love to hear
            from you and help bring your ideas to life.
          </p>
        </div>
      </section>

      {/* Contact Information */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="mb-10">
            <div className="w-20 h-20 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="text-primary" size={32} />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white mb-4">
              Email Us
            </h2>
            <p className="text-xl text-neutral-700 dark:text-neutral-300 mb-6">
              info@mehyar.us
            </p>
            <Button 
              size="lg" 
              onClick={handleEmailClick}
              className="px-8 py-6 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg text-lg"
            >
              Send us an Email
            </Button>
          </div>
        </div>
      </section>
    </>
  );
};

export default Contact;
