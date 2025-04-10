import { useState, useEffect, createContext, useContext } from "react";
import { isAdminShortcut } from "@/lib/utils";

interface AdminContextType {
  isAdminOpen: boolean;
  setIsAdminOpen: (isOpen: boolean) => void;
}

// Create context with default values
const AdminContext = createContext<AdminContextType>({
  isAdminOpen: false,
  setIsAdminOpen: () => {},
});

// Provider component to wrap the app
export const AdminProvider = ({ children }: { children: React.ReactNode }) => {
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Listen for keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAdminShortcut(e)) {
        setIsAdminOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const contextValue = { isAdminOpen, setIsAdminOpen };

  return (
    <AdminContext.Provider value={contextValue}>
      {children}
    </AdminContext.Provider>
  );
};

// Hook to access admin context
export const useAdmin = () => {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
};

export default useAdmin;
