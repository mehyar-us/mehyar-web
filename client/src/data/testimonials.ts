export interface Testimonial {
  name: string;
  title: string;
  company: string;
  quote: string;
  avatar: string;
  rating: number;
}

// Intentionally empty: the public site now uses proof points instead of unverified testimonials.
export const testimonials: Testimonial[] = [];

export default testimonials;
