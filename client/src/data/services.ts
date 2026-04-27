import { Code, Users, Bot, CloudCog, Lightbulb, Database } from "lucide-react";

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
    id: "ai-platforms",
    title: "AI / LLM Systems",
    category: "AI Engineering",
    description: "Design and production delivery for RAG, LLM, voice AI, tool-calling, and AI workflow platforms.",
    features: ["RAG architecture with Pinecone/PostgreSQL", "OpenAI/Gemini application integration", "Voice pipelines with Deepgram and ElevenLabs", "Latency, cost, logging, and reliability optimization"],
    image: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80",
    icon: Bot,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "cloud-platform",
    title: "AWS Cloud Architecture",
    category: "Infrastructure",
    description: "Cloud-native platform design across ECS, Lambda, RDS, S3, API Gateway, EKS, CDK, and Terraform.",
    features: ["Infrastructure as Code", "Kubernetes/EKS and Docker workloads", "Blue-green deployment pipelines", "Secure, compliant production operations"],
    image: "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=1200&q=80",
    icon: CloudCog,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "full-stack-modernization",
    title: "Full-Stack Modernization",
    category: "Product Engineering",
    description: "Modern React/TypeScript, Django/FastAPI/Node, API, and platform modernization from monoliths to scalable services.",
    features: ["React/TypeScript frontends", "Python, Django, FastAPI, Node.js APIs", "Microservices and API integrations", "Performance and bundle optimization"],
    image: "https://images.unsplash.com/photo-1547658719-da2b51169166?auto=format&fit=crop&w=1200&q=80",
    icon: Code,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  },
  {
    id: "devops-ci-cd",
    title: "DevOps & CI/CD",
    category: "Delivery Systems",
    description: "Release pipelines, test automation, observability, deployment reliability, and engineering workflow improvement.",
    features: ["GitHub Actions, CodeBuild, CDK pipelines", "Automated testing and quality gates", "Structured logging and monitoring", "Release cycles reduced from days to hours"],
    image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
    icon: Lightbulb,
    bgColorClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10"
  },
  {
    id: "data-integrations",
    title: "Data & Integrations",
    category: "Data Platforms",
    description: "Marketing, CRM, analytics, and operational data integrations at high volume across complex ecosystems.",
    features: ["Snowflake, DynamoDB, PostgreSQL, MySQL", "Millions of requests/day", "Hundreds of millions of events/month", "GDPR-grade masking and transactional workloads"],
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
    icon: Database,
    bgColorClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10"
  },
  {
    id: "technical-leadership",
    title: "Staff-Level Leadership",
    category: "Technical Direction",
    description: "Architecture reviews, mentoring, vendor coordination, documentation, stakeholder communication, and cross-functional delivery.",
    features: ["Solution design reviews", "Technical standards and reusable practices", "Code reviews and team mentorship", "Regulated documentation and operational handoff"],
    image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80",
    icon: Users,
    bgColorClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10"
  }
];

export default services;
