import { useEffect } from "react";
import { Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact | MehyarSoft";
  }, []);

  const handleEmailClick = () => {
    window.location.href = "mailto:info@mehyar.us?subject=MehyarSoft%20consulting%20request";
  };

  return (
    <>
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
            Tell me where the business is leaking.
          </h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Send the current problem, the tools involved, and what a win would look like. If an audit is the right first step, I will say that before recommending a larger build.
          </p>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-3xl text-center">
          <Card className="bg-white dark:bg-neutral-800 shadow-md">
            <CardContent className="p-8">
              <div className="w-20 h-20 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Mail className="text-primary" size={32} />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-neutral-900 dark:text-white mb-4">
                Request a practical next step
              </h2>
              <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
                Include: business type, current website or tools, bottleneck, timeline, and budget range if known.
              </p>
              <p className="text-xl text-neutral-700 dark:text-neutral-300 mb-6">
                info@mehyar.us
              </p>
              <Button
                size="lg"
                onClick={handleEmailClick}
                className="px-8 py-6 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg text-lg"
              >
                Email MehyarSoft
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
};

export default Contact;
