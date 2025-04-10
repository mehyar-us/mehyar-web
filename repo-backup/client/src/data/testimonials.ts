export interface Testimonial {
  name: string;
  title: string;
  company: string;
  quote: string;
  avatar: string;
  rating: number;
}

export const testimonials: Testimonial[] = [
  {
    name: "Sarah Johnson",
    title: "CTO",
    company: "Finance Solutions Inc.",
    quote: "MehyarSoft automated our workflow, saving us 100+ hours a month. Their team really understood our needs and delivered a solution that exceeded expectations.",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80",
    rating: 5
  },
  {
    name: "Michael Roberts",
    title: "Medical Director",
    company: "City Health Clinic",
    quote: "The custom CRM system MehyarSoft built for our healthcare practice has revolutionized how we manage patient relationships. Highly recommended!",
    avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80",
    rating: 5
  },
  {
    name: "Jennifer Chen",
    title: "COO",
    company: "Urban Retail Group",
    quote: "Working with MehyarSoft on our e-commerce web application was a game-changer. Their expertise and commitment to quality is impressive.",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80",
    rating: 4.5
  },
  {
    name: "David Wilson",
    title: "CEO",
    company: "DataTech Solutions",
    quote: "MehyarSoft delivered our business intelligence dashboard on time and under budget. The solution has transformed how we make strategic decisions.",
    avatar: "https://images.unsplash.com/photo-1568602471122-7832951cc4c5?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80",
    rating: 5
  },
  {
    name: "Emily Parker",
    title: "VP of Operations",
    company: "Global Manufacturing Inc.",
    quote: "The automation solution MehyarSoft implemented has streamlined our production processes and significantly reduced errors. Their team was professional and knowledgeable throughout the project.",
    avatar: "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?ixlib=rb-4.0.3&auto=format&fit=crop&w=200&q=80",
    rating: 5
  }
];

export default testimonials;
