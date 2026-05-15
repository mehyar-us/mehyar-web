import ContactSection from "@/components/contact-section";
import QuickAnswer from "@/components/QuickAnswer";

const Booking = () => {
  return (
    <>
      <section className="px-4 pb-16 pt-28 sm:pb-20 bg-gradient-to-br from-primary/5 to-secondary/5 dark:from-primary/10 dark:to-secondary/10">
        <div className="container mx-auto text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-primary">Service-specific booking</p>
          <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-bold tracking-tight text-neutral-900 dark:text-white md:text-6xl">
            Request a MehyarSoft consulting call.
          </h1>
          <p className="mx-auto max-w-3xl text-lg leading-8 text-neutral-700 dark:text-neutral-300 md:text-xl">
            Pick Tech Audit, $330 Rescue, Website cleanup, AI follow-up, Automation sprint, Systems consulting, Retainer, or General. If live calendar auth is unavailable, this captures a manual scheduling request without faking open slots.
          </p>
        </div>
      </section>
      <QuickAnswer
        question="Can I book a call directly?"
        answer="Use this booking request path to choose a service and preferred time window. MehyarSoft only confirms a calendar event after explicit confirmation; otherwise you will receive available times manually."
      />
      <ContactSection mode="booking_call" source="booking_page" campaign="booking_call" />
    </>
  );
};

export default Booking;
