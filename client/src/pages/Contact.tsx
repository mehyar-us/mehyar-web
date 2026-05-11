import { useEffect } from "react";
import ContactSection from "@/components/contact-section";

const Contact = () => {
  useEffect(() => {
    document.title = "Contact | MehyarSoft";
  }, []);

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
      <ContactSection />
    </>
  );
};

export default Contact;
