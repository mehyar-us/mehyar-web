import { useEffect } from "react";
import { Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ContactSection from "@/components/contact-section";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact Us | MehyarSoft";
  }, []);

  const contactPoints = [
    {
      icon: Mail,
      title: "Email Us",
      details: ["info@mehyar.us"],
    }
  ];

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

      {/* Contact Information Cards */}
      <section className="py-12 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {contactPoints.map((point, index) => (
              <Card
                key={index}
                className="bg-white dark:bg-neutral-800 shadow-md hover:shadow-lg transition-shadow"
              >
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4">
                    <point.icon className="text-primary" size={24} />
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-3">
                    {point.title}
                  </h3>
                  <div className="space-y-1">
                    {point.details.map((detail, i) => (
                      <p
                        key={i}
                        className="text-neutral-700 dark:text-neutral-300"
                      >
                        {detail}
                      </p>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>



      {/* Contact Form */}
      <ContactSection />
    </>
  );
};

export default Contact;
