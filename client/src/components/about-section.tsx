import { Card, CardContent } from "@/components/ui/card";

const AboutSection = () => {
  return (
    <section id="about" className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="flex flex-col lg:flex-row items-center">
          <div className="lg:w-1/2 mb-10 lg:mb-0 lg:pr-12">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
              About MehyarSoft
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-4">
              MehyarSoft is a technology consulting and development company
              specializing in custom web applications, CRM systems, and
              automation solutions. Our mission is to help businesses leverage
              technology to increase efficiency, improve customer relationships,
              and drive growth.
            </p>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
              Founded in 2015, we've worked with clients across industries
              including finance, healthcare, retail, and manufacturing. Our team
              of experienced developers, designers, and business analysts brings
              a wealth of knowledge to every project.
            </p>

            <div className="flex flex-wrap gap-4 mt-8">
              <Card className="bg-white dark:bg-neutral-900 shadow-sm">
                <CardContent className="p-4">
                  <div className="text-primary font-bold text-3xl mb-1">
                    100+
                  </div>
                  <div className="text-neutral-700 dark:text-neutral-300">
                    Projects Delivered
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white dark:bg-neutral-900 shadow-sm">
                <CardContent className="p-4">
                  <div className="text-primary font-bold text-3xl mb-1">
                    35+
                  </div>
                  <div className="text-neutral-700 dark:text-neutral-300">
                    Team Members
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-white dark:bg-neutral-900 shadow-sm">
                <CardContent className="p-4">
                  <div className="text-primary font-bold text-3xl mb-1">
                    12
                  </div>
                  <div className="text-neutral-700 dark:text-neutral-300">
                    Industries Served
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
          <div className="lg:w-1/2">
            <img
              src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80"
              alt="MehyarSoft team"
              className="rounded-lg shadow-xl w-full"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
