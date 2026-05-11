import { Code, Laptop, Users, Bot, ShoppingCart, Activity, Building, FileText, Database } from "lucide-react";

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
    title: "FinTech Dashboard",
    description: "A comprehensive financial analytics dashboard for a leading investment firm.",
    category: "Finance",
    image: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Global Investment Partners",
    year: "2022",
    challenge: "The client needed a unified dashboard solution to consolidate data from multiple financial systems and provide real-time portfolio analytics for their investment managers. The existing process involved manual data aggregation, leading to delays in decision-making and inconsistent reporting.",
    solution: "We developed a secure, cloud-based dashboard that integrates with multiple data sources via APIs. The solution features customizable views for different user roles, interactive data visualization, and automated reporting capabilities. The system includes predictive analytics models to identify investment trends and potential risks.",
    results: [
      "Reduced report generation time by 85%",
      "Increased investment manager productivity by 32%",
      "Improved data accuracy with real-time validation",
      "Enabled deeper portfolio analysis with advanced filtering"
    ],
    technologies: ["React", "Node.js", "D3.js", "MongoDB", "AWS", "Docker"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: Code
  },
  {
    id: 2,
    title: "Patient Management CRM",
    description: "Custom CRM solution for a network of specialist clinics to manage patient relationships.",
    category: "Healthcare",
    image: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1579684385127-1ef15d508118?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "MedSpecialists Network",
    year: "2022",
    challenge: "The client, a growing network of specialized medical clinics, struggled with fragmented patient information across different locations. They needed a unified CRM system to improve patient care coordination, streamline appointment scheduling, and enhance patient communication while ensuring HIPAA compliance.",
    solution: "We developed a custom healthcare CRM with secure patient profiles, appointment management, treatment history tracking, and automated communication features. The system includes a patient portal for self-service options and integrates with the client's existing electronic health records (EHR) system. We implemented role-based access controls and comprehensive audit logging to ensure data privacy and security.",
    results: [
      "Reduced appointment no-shows by 42% through automated reminders",
      "Improved cross-location care coordination by providing unified patient records",
      "Increased patient satisfaction scores by 28%",
      "Streamlined billing process, reducing administrative time by 20%"
    ],
    technologies: ["Angular", "Python", "Django", "PostgreSQL", "Azure", "OAuth 2.0"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Users
  },
  {
    id: 3,
    title: "Supply Chain Automation",
    description: "Workflow automation for inventory management and order processing for a retail chain.",
    category: "Retail",
    image: "https://images.unsplash.com/photo-1563013544-824ae1b704d3?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Urban Retail Group",
    year: "2021",
    challenge: "The client, a mid-sized retail chain with 50+ locations, was struggling with inefficient inventory management and manual order processing. Stock discrepancies, fulfillment delays, and high administrative overhead were affecting customer satisfaction and profit margins.",
    solution: "We implemented an end-to-end supply chain automation solution that connects POS systems, warehouse management, and supplier ordering. The system uses predictive analytics for demand forecasting and automatic reordering based on customizable rules. We incorporated barcode scanning for accurate inventory tracking and developed a supplier portal for streamlined communication.",
    results: [
      "Reduced inventory holding costs by 23%",
      "Decreased order fulfillment time from 3 days to same-day",
      "Eliminated 95% of manual data entry in the ordering process",
      "Improved inventory accuracy to 99.8%"
    ],
    technologies: ["React", "Node.js", "RabbitMQ", "MySQL", "Kubernetes", "TensorFlow"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    icon: Bot
  },
  {
    id: 4,
    title: "E-Commerce Platform",
    description: "Custom online shopping experience with personalized recommendations for a specialty retailer.",
    category: "Retail",
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1571867424488-4565932edb41?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Artisan Goods Co.",
    year: "2022",
    challenge: "The client, a specialty retailer of handcrafted products, needed to transition from a third-party marketplace to their own e-commerce platform. They required a solution that would showcase their unique products, reflect their brand identity, and provide a personalized shopping experience to drive customer loyalty.",
    solution: "We developed a custom e-commerce platform with advanced product filtering, high-quality image galleries, and personalized recommendation algorithms. The platform includes a content management system for easy product updates, integrated payment processing with multiple options, and a responsive design optimized for mobile shopping. We implemented a customer account area with order history, saved favorites, and personalized offers.",
    results: [
      "Increased conversion rate by 34% compared to previous marketplace sales",
      "Improved average order value by 28% through cross-selling features",
      "Reduced cart abandonment rate by 40%",
      "Generated 45% more return customers through personalization"
    ],
    technologies: ["Vue.js", "Nuxt.js", "Strapi CMS", "GraphQL", "Stripe", "Algolia"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: ShoppingCart
  },
  {
    id: 5,
    title: "Telemedicine Platform",
    description: "Secure video consultation system with integrated health records for a medical provider.",
    category: "Healthcare",
    image: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1526256262350-7da7584cf5eb?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "TeleHealth Providers",
    year: "2021",
    challenge: "In response to growing demand for remote healthcare services, the client needed a secure, HIPAA-compliant telemedicine solution that would integrate with their existing patient records system. They required features for appointment scheduling, secure video consultations, digital prescriptions, and follow-up care management.",
    solution: "We created a comprehensive telemedicine platform with enterprise-grade video conferencing capabilities optimized for medical consultations. The system includes secure messaging, digital intake forms, screen sharing for test results, and e-prescription functionality. We implemented seamless integration with the client's EHR system and added features for post-visit care plan tracking and automated follow-ups.",
    results: [
      "Enabled the client to serve 200% more patients with existing staff",
      "Reduced appointment cancellations by 35%",
      "Decreased administrative workload by 25%",
      "Maintained 96% patient satisfaction rating for virtual visits"
    ],
    technologies: ["React", "WebRTC", "Node.js", "MongoDB", "FHIR API", "AWS HIPAA-eligible services"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Activity
  },
  {
    id: 6,
    title: "Property Management System",
    description: "Comprehensive real estate management solution for a commercial property firm.",
    category: "Real Estate",
    image: "https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Meridian Properties",
    year: "2022",
    challenge: "The client, a growing commercial property management firm, was struggling with fragmented systems for tenant management, maintenance tracking, financial reporting, and lease administration. They needed a unified platform to efficiently manage their expanding portfolio of office buildings and retail spaces.",
    solution: "We developed an integrated property management system with modules for lease management, tenant portals, maintenance request tracking, automated billing, and financial reporting. The platform includes interactive building maps, document management with electronic signatures, and analytics dashboards for property performance metrics. We implemented IoT integration for smart building features such as access control and environmental monitoring.",
    results: [
      "Reduced lease renewal processing time by 60%",
      "Decreased maintenance response time from 48 to 4 hours",
      "Improved rent collection efficiency by 25%",
      "Enhanced tenant satisfaction scores by 40%"
    ],
    technologies: ["Angular", "ASP.NET Core", "SQL Server", "Power BI", "IoT Hub", "Azure"],
    badgeColorClass: "text-accent",
    badgeBgClass: "bg-accent/10",
    textColorClass: "text-accent",
    hoverColorClass: "text-accent-dark",
    icon: Building
  },
  {
    id: 7,
    title: "Legal Document Management",
    description: "AI-powered legal document analysis and management system for a law firm.",
    category: "Legal",
    image: "https://images.unsplash.com/photo-1589829545856-d10d557cf95f?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1575505586569-646b2ca898fc?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Peterson & Associates",
    year: "2021",
    challenge: "The client, a mid-sized law firm, was managing thousands of legal documents with an outdated system that made document retrieval time-consuming and inefficient. They needed a solution that could intelligently organize documents, extract key information, and provide advanced search capabilities to improve attorney productivity.",
    solution: "We implemented an AI-powered document management system with optical character recognition (OCR), natural language processing for document classification, and machine learning for key information extraction. The system includes version control, collaborative editing with redlining, advanced search with legal-specific filters, and automated document assembly for standard legal forms. We added client portal features for secure document sharing and approval workflows.",
    results: [
      "Reduced document retrieval time by 80%",
      "Improved accuracy of document categorization to 96%",
      "Saved an average of 15 hours per attorney per month",
      "Decreased document processing costs by 40%"
    ],
    technologies: ["React", "Python", "Django", "TensorFlow", "Elasticsearch", "AWS"],
    badgeColorClass: "text-primary",
    badgeBgClass: "bg-primary/10",
    textColorClass: "text-primary",
    hoverColorClass: "text-primary-dark",
    icon: FileText
  },
  {
    id: 8,
    title: "Manufacturing Analytics Platform",
    description: "Real-time production monitoring and analytics system for a manufacturing company.",
    category: "Manufacturing",
    image: "https://images.unsplash.com/photo-1581092921461-39b21d6ae523?ixlib=rb-4.0.3&auto=format&fit=crop&w=1200&q=80",
    detailImage: "https://images.unsplash.com/photo-1566845673139-bf8d10b4a8e0?ixlib=rb-4.0.3&auto=format&fit=crop&w=1600&q=80",
    client: "Precision Industries",
    year: "2022",
    challenge: "The client, a precision manufacturing company, lacked visibility into their production processes, resulting in unexpected downtime, quality issues, and inefficient resource allocation. They needed a system to monitor equipment performance in real-time, predict maintenance needs, and identify opportunities for process improvement.",
    solution: "We developed a manufacturing analytics platform that connects to production equipment via IoT sensors to collect real-time operational data. The system includes machine learning models for predictive maintenance, quality control analytics to identify defect patterns, and production scheduling optimization. We implemented customizable dashboards for different roles (operators, managers, executives) and automated alerting for critical events or anomalies.",
    results: [
      "Reduced unplanned downtime by 35%",
      "Decreased defect rates by 27%",
      "Improved overall equipment effectiveness (OEE) by 18%",
      "Optimized resource allocation, resulting in 15% cost savings"
    ],
    technologies: ["React", "Node.js", "Time Series Database", "TensorFlow", "MQTT", "Azure IoT"],
    badgeColorClass: "text-secondary",
    badgeBgClass: "bg-secondary/10",
    textColorClass: "text-secondary",
    hoverColorClass: "text-secondary-dark",
    icon: Database
  }
];

export default projects;
