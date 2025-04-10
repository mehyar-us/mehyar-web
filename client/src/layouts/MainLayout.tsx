import { ReactNode, useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AdminPanel from "@/components/admin/admin-panel";
import { isAdminShortcut } from "@/lib/utils";

interface MainLayoutProps {
  children: ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAdminShortcut(e)) {
        setIsAdminOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col min-h-screen antialiased bg-white dark:bg-neutral-900 transition-colors duration-300">
      <Navbar />
      <main className="flex-grow">{children}</main>
      <Footer />
      <AdminPanel isOpen={isAdminOpen} onClose={() => setIsAdminOpen(false)} />
    </div>
  );
};

export default MainLayout;
