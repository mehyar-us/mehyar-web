import { useEffect } from "react";
import AdminPanel from "@/components/admin/admin-panel";
import { useAdmin } from "@/hooks/use-admin";
import { useLocation } from "wouter";

const Admin = () => {
  const { isAdminOpen, setIsAdminOpen } = useAdmin();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    document.title = "Admin Panel | MehyarSoft";
    setIsAdminOpen(true);

    return () => {
      setIsAdminOpen(false);
    };
  }, [setIsAdminOpen]);

  useEffect(() => {
    // If user manually closes the admin panel, redirect to home
    if (!isAdminOpen) {
      setLocation("/");
    }
  }, [isAdminOpen, setLocation]);

  return (
    <div className="pt-16">
      <AdminPanel isOpen={isAdminOpen} onClose={() => setLocation("/")} />
    </div>
  );
};

export default Admin;
