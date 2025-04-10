import { useEffect } from "react";
import { Building, Mail, Phone, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import ContactSection from "@/components/contact-section";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact Us | MehyarSoft";
  }, []);

  const contactPoints = [
    {
      icon: Building,
      title: "Main Office",
      details: ["123 Tech Avenue, Suite 500", "San Francisco, CA 94107", "United States"],
    },
    {
      icon: Mail,
      title: "Email Us",
      details: ["info@mehyarsoft.com", "support@mehyarsoft.com", "careers@mehyarsoft.com"],
    },
    {
      icon: Phone,
      title: "Call Us",
      details: ["+1 (555) 123-4567", "+1 (555) 987-6543"],
    },
    {
      icon: MapPin,
      title: "Working Hours",
      details: ["Monday - Friday: 9:00 AM - 6:00 PM", "Saturday: 10:00 AM - 2:00 PM", "Sunday: Closed"],
    },
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

      {/* Map Section */}
      <section className="py-12 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="rounded-xl overflow-hidden shadow-lg">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3153.0501969345894!2d-122.4010206!3d37.7894339!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x80858088be30eca9%3A0x56e1d3c343e70f1!2sSan%20Francisco%2C%20CA%2094107!5e0!3m2!1sen!2sus!4v1680552010293!5m2!1sen!2sus"
              width="100%"
              height="450"
              style={{ border: 0 }}
              allowFullScreen={true}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="MehyarSoft Office Location"
            ></iframe>
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <ContactSection />
    </>
  );
};

export default Contact;
