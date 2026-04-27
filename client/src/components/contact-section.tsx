import { useState } from "react";
import { Mail, Linkedin, Download } from "lucide-react";
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = `\nName: ${formData.name}\nEmail: ${formData.email}\nCompany: ${formData.company}\nMessage: ${formData.message}\n    `;
    window.location.href = `mailto:mrswelim@gmail.com?subject=Opportunity from ${formData.name}&body=${encodeURIComponent(body)}`;
    toast({ title: "Opening email client", description: "Your email client should open with your message." });
    setFormData({ name: "", email: "", company: "", message: "" });
  };

  return (
    <section id="contact" className="py-20 px-4 bg-white dark:bg-neutral-900">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            Contact Mehyar
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Recruiters, founders, engineering leaders, and hiring managers: send the role, compensation range, location/remote expectations, and interview timeline.
          </p>
        </div>

        <div className="flex flex-col lg:flex-row gap-12">
          <div className="lg:w-1/2">
            <form id="contactForm" className="space-y-6" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Name</Label>
                  <Input type="text" id="name" value={formData.name} onChange={handleChange} placeholder="Your name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Email</Label>
                  <Input type="email" id="email" value={formData.email} onChange={handleChange} placeholder="your@email.com" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Company</Label>
                <Input type="text" id="company" value={formData.company} onChange={handleChange} placeholder="Company / recruiting firm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Role / opportunity</Label>
                <Textarea id="message" value={formData.message} onChange={handleChange} rows={5} placeholder="Role title, salary/TC range, remote/hybrid, stack, and timeline" required />
              </div>
              <Button type="submit" className="w-full px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg">
                Email Mehyar
              </Button>
            </form>
          </div>
          <div className="lg:w-1/2 space-y-8">
            <div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">Direct links</h3>
              <div className="space-y-4">
                <Card className="bg-white dark:bg-neutral-800 shadow-sm border-neutral-200 dark:border-neutral-700">
                  <CardContent className="p-4 flex items-start">
                    <Mail className="text-primary mt-1" size={20} />
                    <div className="ml-4">
                      <h4 className="font-medium text-neutral-900 dark:text-white">Email</h4>
                      <a href="mailto:mrswelim@gmail.com" className="text-neutral-700 dark:text-neutral-300 hover:text-primary">mrswelim@gmail.com</a>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-white dark:bg-neutral-800 shadow-sm border-neutral-200 dark:border-neutral-700">
                  <CardContent className="p-4 flex items-start">
                    <Linkedin className="text-primary mt-1" size={20} />
                    <div className="ml-4">
                      <h4 className="font-medium text-neutral-900 dark:text-white">LinkedIn</h4>
                      <a href="https://www.linkedin.com/in/mehyarswelim" target="_blank" rel="noopener noreferrer" className="text-neutral-700 dark:text-neutral-300 hover:text-primary">linkedin.com/in/mehyarswelim</a>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-white dark:bg-neutral-800 shadow-sm border-neutral-200 dark:border-neutral-700">
                  <CardContent className="p-4 flex items-start">
                    <Download className="text-primary mt-1" size={20} />
                    <div className="ml-4">
                      <h4 className="font-medium text-neutral-900 dark:text-white">Resume</h4>
                      <a href="/Mehyar-Swelim-Resume.txt" download className="text-neutral-700 dark:text-neutral-300 hover:text-primary">Download text resume</a>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4">Fast screen fit</h3>
              <div className="space-y-4">
                {["Staff / Principal Software Engineer", "AI Platform / LLM / RAG Engineer", "Cloud Architect / Solutions Architect", "Hands-on Engineering Lead"].map((role) => (
                  <Card key={role} className="bg-white dark:bg-neutral-800 shadow-sm border-neutral-200 dark:border-neutral-700">
                    <CardContent className="p-4 text-neutral-700 dark:text-neutral-300">{role}</CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ContactSection;
