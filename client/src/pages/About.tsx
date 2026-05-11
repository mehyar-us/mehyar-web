import { useEffect } from "react";
import { Link } from "wouter";
import { CheckCircle, Award, Users, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import CTASection from "@/components/cta-section";

const About = () => {
  useEffect(() => {
    document.title = "About Us | MehyarSoft";
  }, []);

  const values = [
    {
      title: "Innovation",
      description: "We continuously seek new and better ways to solve problems and create value for our clients.",
      icon: <Award className="h-6 w-6 text-primary" />,
    },
    {
      title: "Excellence",
      description: "We are committed to delivering the highest quality solutions and experiences for our clients.",
      icon: <CheckCircle className="h-6 w-6 text-primary" />,
    },
    {
      title: "Collaboration",
      description: "We work closely with our clients and each other to achieve the best possible outcomes.",
      icon: <Users className="h-6 w-6 text-primary" />,
    },
    {
      title: "Agility",
      description: "We adapt quickly to changing needs and circumstances to deliver effective solutions.",
      icon: <Clock className="h-6 w-6 text-primary" />,
    },
  ];

  const timeline = [
    {
      year: "2015",
      title: "MehyarSoft Founded",
      description: "MehyarSoft was established with a vision to help businesses leverage technology for growth.",
    },
    {
      year: "2017",
      title: "Expanded Service Offerings",
      description: "Added CRM development and automation solutions to our core service offerings.",
    },
    {
      year: "2019",
      title: "Team Growth",
      description: "Expanded our team to 20+ technology professionals to serve a growing client base.",
    },
    {
      year: "2020",
      title: "Global Expansion",
      description: "Started serving international clients and established partnerships across industries.",
    },
    {
      year: "2022",
      title: "Innovation Lab Launch",
      description: "Launched our Innovation Lab to explore emerging technologies and develop new solutions.",
    },
    {
      year: "2023",
      title: "New Headquarters",
      description: "Moved to a larger office space to accommodate our growing team and operations.",
    },
  ];

  return (
    <>
      {/* About Hero */}
      <section className="pt-28 pb-20 px-4 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row items-center">
            <div className="md:w-1/2 mb-10 md:mb-0 md:pr-12">
              <h1 className="text-4xl md:text-5xl font-bold text-neutral-900 dark:text-white mb-6">
                About MehyarSoft
              </h1>
              <p className="text-lg text-neutral-700 dark:text-neutral-300 mb-6">
                We're a team of passionate technology experts dedicated to
                helping businesses succeed in the digital world. Since 2015,
                we've been delivering custom solutions that drive efficiency,
                growth, and innovation.
              </p>
              <Link href="/contact">
                <Button className="px-6 py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors shadow-md hover:shadow-lg">
                  Get in Touch
                </Button>
              </Link>
            </div>
            <div className="md:w-1/2">
              <img
                src="/mehyar-swelim.jpg"
                alt="Mehyar Swelim, CEO & Founder of MehyarSoft"
                className="rounded-lg shadow-xl w-full object-cover h-96"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Our Mission */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto max-w-5xl text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
            Our Mission
          </h2>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 mb-12 leading-relaxed">
            To empower businesses with innovative technology solutions that
            enhance efficiency, drive growth, and create competitive advantages
            in a rapidly evolving digital landscape.
          </p>

          <Separator className="mb-12" />

          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-6">
            Our Vision
          </h2>
          <p className="text-xl text-neutral-700 dark:text-neutral-300 leading-relaxed">
            To be the trusted technology partner for forward-thinking
            organizations, known for delivering exceptional solutions that
            transform the way businesses operate and succeed.
          </p>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
              Our Core Values
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              These principles guide everything we do at MehyarSoft.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {values.map((value, index) => (
              <Card key={index} className="bg-white dark:bg-neutral-900 shadow-md h-full">
                <CardContent className="p-6 flex flex-col items-center text-center">
                  <div className="w-12 h-12 bg-primary/10 dark:bg-primary/20 rounded-full flex items-center justify-center mb-4">
                    {value.icon}
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                    {value.title}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    {value.description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Our History */}
      <section className="py-20 px-4 bg-white dark:bg-neutral-900">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
              Our Journey
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              From our founding to where we are today - the MehyarSoft story.
            </p>
          </div>

          <div className="max-w-4xl mx-auto">
            {timeline.map((item, index) => (
              <div
                key={index}
                className="flex flex-col md:flex-row mb-12 last:mb-0"
              >
                <div className="md:w-1/4 mb-4 md:mb-0">
                  <div className="bg-primary text-white text-xl font-bold rounded-lg px-4 py-2 inline-block">
                    {item.year}
                  </div>
                </div>
                <div className="md:w-3/4">
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">
                    {item.title}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
        <div className="container mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
              Our Team
            </h2>
            <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
              Meet the talented people behind MehyarSoft.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                name: "Mehyar Swelim",
                role: "CEO & Founder",
                image: "/mehyar-swelim.jpg",
              },
              {
                name: "Sarah Johnson",
                role: "CTO",
                image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
              },
              {
                name: "Michael Chen",
                role: "Lead Developer",
                image: "https://images.unsplash.com/photo-1568602471122-7832951cc4c5?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
              },
              {
                name: "Emily Davis",
                role: "UX Designer",
                image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?ixlib=rb-4.0.3&auto=format&fit=crop&w=400&q=80",
              },
            ].map((member, index) => (
              <Card key={index} className="bg-white dark:bg-neutral-900 shadow-md overflow-hidden">
                <img
                  src={member.image}
                  alt={member.name}
                  className="w-full h-64 object-cover object-center"
                />
                <CardContent className="p-4 text-center">
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white">
                    {member.name}
                  </h3>
                  <p className="text-neutral-700 dark:text-neutral-300">
                    {member.role}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-12">
            <Link href="/careers">
              <Button variant="outline" className="px-6 py-3 bg-white dark:bg-neutral-900 text-primary font-medium rounded-lg transition-colors shadow-md hover:shadow-lg border border-neutral-200 dark:border-neutral-700">
                Join Our Team
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <CTASection />
    </>
  );
};

export default About;
