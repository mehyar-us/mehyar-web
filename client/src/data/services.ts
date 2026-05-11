import { Laptop, Code, Users, Bot, Figma, Lightbulb, CloudCog } from "lucide-react";

export interface Service {
  id: string;
  title: string;
  category: string;
  description: string;
  features: string[];
  image: string;
  icon: any;
  bgColorClass: string;
  textColorClass: string;
  hoverColorClass: string;
  badgeColorClass: string;
  badgeBgClass: string;
}

export const services: Service[] = [
  {
    id: "web-applications",
    title: "Web Application Development",
    category: "Development",
    description: "Custom web applications designed to streamline your business processes and enhance user experience.",
    features: [
      "Responsive web applications that work on any device",
      "Modern, intuitive user interfaces with focus on UX/UI",
      "Secure, scalable backend architecture",
      "API integration with third-party services",
      "Progressive Web Apps (PWA) for offline capabilities",
      "Advanced data visualization and reporting"
    ],
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: Code,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "crm-systems",
    title: "CRM Systems",
    category: "Business Solutions",
    description: "Build or customize CRM systems that help you manage customer relationships and improve sales performance.",
    features: [
      "Custom CRM development tailored to your workflow",
      "CRM integration with existing business systems",
      "Customer journey tracking and analytics",
      "Sales pipeline management and forecasting",
      "Automated lead scoring and qualification",
      "Email marketing and communication automation"
    ],
    image: "https://images.unsplash.com/photo-1549923746-c502d488b3ea?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: Users,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "automation-solutions",
    title: "Automation Solutions",
    category: "Automation",
    description: "Automate repetitive tasks and workflows to increase efficiency and reduce operational costs.",
    features: [
      "Business process automation for improved efficiency",
      "Robotic Process Automation (RPA) implementation",
      "Workflow optimization and streamlining",
      "Document processing and data extraction",
      "Integration between disparate systems",
      "Custom automation dashboards and reporting"
    ],
    image: "https://images.unsplash.com/photo-1563986768609-322da13575f3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: Bot,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  },
  {
    id: "ui-ux-design",
    title: "UI/UX Design",
    category: "Design",
    description: "Create intuitive, engaging user interfaces and experiences that delight your customers and improve conversion rates.",
    features: [
      "User research and persona development",
      "Information architecture and user flow mapping",
      "Wireframing and interactive prototyping",
      "Visual design and branding consistency",
      "Usability testing and optimization",
      "Accessibility compliance (WCAG 2.1)"
    ],
    image: "https://images.unsplash.com/photo-1587440871875-191322ee64b0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: Figma,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "technology-consulting",
    title: "Technology Consulting",
    category: "Consulting",
    description: "Strategic technology advisory services to help you make informed decisions about your digital initiatives.",
    features: [
      "Digital transformation strategy development",
      "Technology stack assessment and recommendations",
      "IT roadmap planning and prioritization",
      "Vendor selection and management",
      "Security and compliance auditing",
      "Legacy system modernization planning"
    ],
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: Lightbulb,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "cloud-solutions",
    title: "Cloud Solutions",
    category: "Infrastructure",
    description: "Leverage cloud technologies to improve scalability, reliability, and cost-efficiency of your applications.",
    features: [
      "Cloud migration strategy and implementation",
      "Multi-cloud and hybrid cloud architecture",
      "Infrastructure as Code (IaC) setup",
      "Cloud-native application development",
      "Containerization and microservices",
      "DevOps and CI/CD pipeline implementation"
    ],
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    icon: CloudCog,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  }
];

export default services;
