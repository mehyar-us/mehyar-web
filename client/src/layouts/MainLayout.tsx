import { ReactNode } from "react";
import { useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SupportTicketModal from "@/components/SupportTicketModal";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");

  return (
    <div className="flex flex-col min-h-screen antialiased bg-background text-foreground transition-colors duration-300">
      <Navbar />
      <main className="flex-grow">{children}</main>
      {isAdmin ? null : <Footer />}
      {isAdmin ? null : <SupportTicketModal />}
    </div>
  );
};

export default MainLayout;
