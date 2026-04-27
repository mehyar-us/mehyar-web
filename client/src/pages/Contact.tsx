import { useEffect } from "react";
import { Mail, Linkedin, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact Mehyar Swelim | Staff Software Engineer";
  }, []);

  return (
    <>
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">Contact Mehyar</h1>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            For staff/principal engineering, AI platform, cloud architecture, or hands-on technical leadership opportunities.
          </p>
        </div>
      </section>

      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-white dark:bg-neutral-800 shadow-md border-neutral-200 dark:border-neutral-700">
              <CardContent className="p-6 text-center">
                <Mail className="text-primary mx-auto mb-4" size={32} />
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Email</h2>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">mrswelim@gmail.com</p>
                <a href="mailto:mrswelim@gmail.com?subject=Staff%20%2F%20Principal%20Engineer%20Opportunity"><Button>Email Mehyar</Button></a>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-neutral-800 shadow-md border-neutral-200 dark:border-neutral-700">
              <CardContent className="p-6 text-center">
                <Linkedin className="text-primary mx-auto mb-4" size={32} />
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">LinkedIn</h2>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">linkedin.com/in/mehyarswelim</p>
                <a href="https://www.linkedin.com/in/mehyarswelim" target="_blank" rel="noopener noreferrer"><Button>Open LinkedIn</Button></a>
              </CardContent>
            </Card>
            <Card className="bg-white dark:bg-neutral-800 shadow-md border-neutral-200 dark:border-neutral-700">
              <CardContent className="p-6 text-center">
                <Download className="text-primary mx-auto mb-4" size={32} />
                <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Resume</h2>
                <p className="text-neutral-700 dark:text-neutral-300 mb-4">Text resume for quick screening.</p>
                <a href="/Mehyar-Swelim-Resume.txt" download><Button>Download Resume</Button></a>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </>
  );
};

export default Contact;
