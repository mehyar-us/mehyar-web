import { useState, useRef, useEffect } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { testimonials } from "@/data/testimonials";

const TestimonialsSection = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);

  const handleDotClick = (index: number) => {
    setActiveIndex(index);
    if (carouselRef.current) {
      const itemWidth = carouselRef.current.offsetWidth;
      carouselRef.current.scrollLeft = itemWidth * index;
    }
  };

  // Auto-scroll testimonials
  useEffect(() => {
    const interval = setInterval(() => {
      const nextIndex = (activeIndex + 1) % testimonials.length;
      handleDotClick(nextIndex);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [activeIndex]);

  // Handle scroll event to update active index
  useEffect(() => {
    const handleScroll = () => {
      if (carouselRef.current) {
        const scrollLeft = carouselRef.current.scrollLeft;
        const itemWidth = carouselRef.current.offsetWidth;
        const newIndex = Math.round(scrollLeft / itemWidth);
        if (newIndex !== activeIndex) {
          setActiveIndex(newIndex);
        }
      }
    };

    const carousel = carouselRef.current;
    if (carousel) {
      carousel.addEventListener('scroll', handleScroll);
      return () => carousel.removeEventListener('scroll', handleScroll);
    }
  }, [activeIndex]);

  return (
    <section className="py-20 px-4 bg-neutral-50 dark:bg-neutral-800">
      <div className="container mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-neutral-900 dark:text-white mb-4">
            What Our Clients Say
          </h2>
          <p className="text-lg text-neutral-700 dark:text-neutral-300 max-w-3xl mx-auto">
            Don't just take our word for it - hear from our satisfied clients.
          </p>
        </div>

        <div className="relative">
          <div 
            id="testimonialCarousel" 
            ref={carouselRef}
            className="flex overflow-x-auto snap-x snap-mandatory pb-8 hide-scrollbar scrollbar-hide"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {testimonials.map((testimonial, index) => (
              <div 
                key={index}
                className="flex-shrink-0 w-full md:w-1/2 lg:w-1/3 px-4 snap-center"
              >
                <div className="bg-white dark:bg-neutral-900 p-8 rounded-xl shadow-md h-full">
                  <div className="flex items-center mb-4 text-primary">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={cn(
                          "h-5 w-5 fill-current",
                          i < testimonial.rating ? "text-primary" : "text-neutral-300"
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-neutral-700 dark:text-neutral-300 italic mb-6">
                    "{testimonial.quote}"
                  </p>
                  <div className="flex items-center">
                    <img
                      src={testimonial.avatar}
                      alt={testimonial.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                    <div className="ml-4">
                      <h4 className="font-semibold text-neutral-900 dark:text-white">
                        {testimonial.name}
                      </h4>
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {testimonial.title}, {testimonial.company}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Navigation Dots */}
          <div className="flex justify-center mt-8">
            {testimonials.map((_, index) => (
              <button
                key={index}
                className={cn(
                  "w-3 h-3 rounded-full mx-1 transition-colors",
                  index === activeIndex 
                    ? "bg-primary" 
                    : "bg-neutral-300 dark:bg-neutral-600"
                )}
                onClick={() => handleDotClick(index)}
                aria-label={`Testimonial ${index + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
