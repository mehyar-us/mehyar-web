import { useState } from "react";
import { Mail } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const ContactSection = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const body = `Name: ${formData.name}\nEmail: ${formData.email}\nCompany: ${formData.company}\nMessage: ${formData.message}`;

    window.location.href = `mailto:info@mehyar.us?subject=MehyarSoft consulting request from ${encodeURIComponent(formData.name)}&body=${encodeURIComponent(body)}`;

    toast({
      title: "Opening email client",
      description: "Your email client should open with your consulting request.",
    });

    setFormData({ name: "", email: "", company: "", message: "" });
  };

  return (
    <section id="contact" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Request a tech audit or consulting call
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Describe the business, the current workflow, and where leads or time are being lost. The response will focus on the smallest practical next step.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-1/2">
            <form id="contactForm" className="space-y-6" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name</Label>
                  <Input type="text" id="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Your name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Email</Label>
                  <Input type="email" id="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Your email" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Business / company</Label>
                <Input type="text" id="company" value={formData.company} onChange={handleChange} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Restaurant, clinic, agency, SaaS, etc." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">What needs fixing?</Label>
                <Textarea id="message" value={formData.message} onChange={handleChange} rows={5} className="w-full px-4 py-3 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary resize-none" placeholder="Example: We miss calls after hours, leads do not get followed up, and booking is manual." required />
              </div>
              <Button type="submit" className="w-full px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg">
                Draft Email Request
              </Button>
            </form>
          </div>
          <div className="lg:w-1/2 space-y-8">
            <div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">What to include</h3>
              <div className="space-y-4">
                {["Business type and city/service area", "Current website, CRM, booking, phone, or email tools", "Where customers or staff time are being lost", "Urgency and budget range if known"].map((item) => (
                  <Card key={item} className="bg-white dark:bg-neutral-800 shadow-sm">
                    <CardContent className="p-4 text-neutral-700 dark:text-neutral-300">{item}</CardContent>
                  </Card>
                ))}
              </div>
            </div>
            <div className="flex items-start">
              <div className="w-10 h-10 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <Mail className="text-primary" size={18} />
              </div>
              <div className="ml-4">
                <h4 className="font-medium text-neutral-900 dark:text-white">Email</h4>
                <a href="mailto:info@mehyar.us" className="text-neutral-700 dark:text-neutral-300 hover:text-primary">info@mehyar.us</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
