import { Code, Activity, Database, Bot, Building } from "lucide-react";

export interface PortfolioProject {
  id: number;
  title: string;
  description: string;
  category: string;
  image: string;
  detailImage?: string;
  client: string;
  year: string;
  challenge: string;
  solution: string;
  results: string[];
  technologies: string[];
  badgeColorClass: string;
  badgeBgClass: string;
  textColorClass: string;
  hoverColorClass: string;
  icon?: any;
}

export const projects: PortfolioProject[] = [
  {
    id: 1,
    title: "AI Voice Assistant Platform",
    description: "Production-ready conversational AI platform with STT, LLM/RAG, tool calling, and TTS workflows.",
    category: "AI / LLM Systems",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1600&q=80",
    client: "Foragr.ai",
    year: "2025",
    challenge: "The founding team needed a reliable AI voice assistant capable of scheduling, lead capture, escalation, and grounded answers from business context.",
    solution: "Designed the end-to-end pipeline: Deepgram speech-to-text, OpenAI/Gemini reasoning with RAG, Pinecone/PostgreSQL retrieval, tool-calling workflows, and ElevenLabs text-to-speech with structured logging and performance monitoring.",
    results: ["Delivered production-ready architecture", "Implemented grounded context-aware responses", "Enabled real-world workflow actions", "Documented system for founder handoff"],
    technologies: ["OpenAI", "Gemini", "Deepgram", "ElevenLabs", "Pinecone", "PostgreSQL", "RAG", "Tool Calling"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: Bot
  },
  {
    id: 2,
    title: "Enterprise Analytics Platform Re-Architecture",
    description: "v1 to v2 modernization with Django REST, React/TypeScript, AWS CDK, CI/CD, and scalable dashboards.",
    category: "Platform Modernization",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1600&q=80",
    client: "PMC Analytics",
    year: "2023-2025",
    challenge: "The company needed a cleaner, faster analytics platform for large-scale enterprise workloads and 5K+ server capacity analytics.",
    solution: "Owned architecture and technical direction, re-architected backend/frontend, modernized CI/CD and testing, optimized React performance, and implemented AWS deployment pipelines with CDK, GitHub Actions, CodeBuild, and blue-green releases.",
    results: ["Reduced manual reporting by 40%", "Reduced release cycles from days to hours", "Improved release velocity and defect control", "Supported 5K+ server capacity analytics"],
    technologies: ["Django REST", "React", "TypeScript", "AWS CDK", "GitHub Actions", "CodeBuild", "MySQL", "Docker"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Database
  },
  {
    id: 3,
    title: "Multi-Tenant Video Platform",
    description: "Cloud-native video platform scaled to 100K+ users with 99.95% uptime on AWS and Kubernetes/EKS.",
    category: "Cloud Platform",
    image: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1516321497487-e288fb19713f?auto=format&fit=crop&w=1600&q=80",
    client: "StringFlix",
    year: "2019-2023",
    challenge: "The product needed full infrastructure ownership, scalable backend systems, and reliable deployment pipelines as usage grew.",
    solution: "Architected and operated the platform, owned backend/infrastructure/deployment pipelines, built cloud-native services on AWS and Kubernetes/EKS, and drove the technical roadmap as co-founder/CTO.",
    results: ["Scaled to 100K+ users", "Maintained 99.95% uptime", "Enabled rapid deployments and feature iteration", "Owned full technical strategy across product lifecycle"],
    technologies: ["AWS", "Kubernetes", "EKS", "Docker", "CI/CD", "Backend Systems", "Cloud Infrastructure"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    icon: Activity
  },
  {
    id: 4,
    title: "High-Throughput Marketing API Ecosystem",
    description: "Marketing APIs and integrations handling millions of requests per day and hundreds of millions of monthly events.",
    category: "API / Data Engineering",
    image: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1600&q=80",
    client: "What If Media Group",
    year: "2018-2023",
    challenge: "The business needed reliable, scalable APIs and integrations across dozens of marketing and CRM platforms with real-time analytics workloads.",
    solution: "Built backend and integration architecture across vendors, integrated 50+ marketing and CRM systems, designed Snowflake/DynamoDB data pipelines, and improved reliability through automation and monitoring.",
    results: ["Handled millions of requests per day", "Processed hundreds of millions of events monthly", "Integrated 50+ marketing and CRM platforms", "Improved reliability and reduced defects"],
    technologies: ["PHP", "Node.js", "Snowflake", "DynamoDB", "APIs", "Monitoring", "Automation"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: Code
  },
  {
    id: 5,
    title: "Regulated Commercial Systems Leadership",
    description: "Architecture, solution reviews, production operations, vendor delivery, documentation, and regulated support for pharmaceutical systems.",
    category: "Regulated Systems",
    image: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?auto=format&fit=crop&w=1600&q=80",
    client: "Shionogi Inc. (U.S.)",
    year: "2025-Present",
    challenge: "Commercial systems require architecture leadership, production releases, support, documentation, troubleshooting, and coordination across agencies, IT teams, and vendor partners.",
    solution: "Provide subject matter expertise for digital solution reviews, deploy releases, conduct proof-of-concepts, prescribe standards, resolve complex issues, and author technical/operational documentation for pharmaceutical standards.",
    results: ["Improved reusable solution design practices", "Supported production digital and middleware systems", "Transferred operational knowledge to support teams", "Maintained regulated technical documentation"],
    technologies: ["Web Applications", "Middleware", "Marketing Automation", "CMS", "Security Platforms", "Documentation", "Operations"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Building
  }
];

export default projects;
