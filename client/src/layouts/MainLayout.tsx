import { ReactNode } from "react";
import { useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SupportTicketModal from "@/components/SupportTicketModal";
import MayorDock from "@/components/MayorDock";


interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");

  return (
    <div className={`flex min-h-screen flex-col bg-background text-foreground antialiased transition-colors duration-300 ${isAdmin ? "pb-0" : "marketing-site"}`}>
      {isAdmin ? null : <><a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-background focus:p-4">Skip to content</a><Navbar /></>}
      <main id="main-content" tabIndex={-1} className="flex-grow">{children}</main>
      {isAdmin ? null : <Footer />}
      {isAdmin ? null : <SupportTicketModal />}
      {isAdmin ? null : <MayorDock />}

    </div>
  );
};

export default MainLayout;
