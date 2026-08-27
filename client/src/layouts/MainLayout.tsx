import { ReactNode } from "react";
import { useLocation } from "wouter";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SupportTicketModal from "@/components/SupportTicketModal";
import MobileBottomNav from "@/components/MobileBottomNav";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [location] = useLocation();
  const isAdmin = location.startsWith("/admin");

  return (
    <div className={`flex min-h-screen flex-col bg-background text-foreground antialiased transition-colors duration-300 ${isAdmin ? "pb-0" : "pb-[calc(4rem+env(safe-area-inset-bottom,0px))] min-[1180px]:pb-0"}`}>
      {isAdmin ? null : <Navbar />}
      <main className="flex-grow">{children}</main>
      {isAdmin ? null : <Footer />}
      {isAdmin ? null : <SupportTicketModal />}
      {isAdmin ? null : <MobileBottomNav />}
    </div>
  );
};

export default MainLayout;
