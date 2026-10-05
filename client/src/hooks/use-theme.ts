import { useState, useEffect } from "react";

interface UseThemeReturn {
  isDarkMode: boolean;
  toggleTheme: () => void;
}

export const useTheme = (): UseThemeReturn => {
  // Initialize theme from localStorage or system preference
  const getInitialTheme = (): boolean => {
    // Check if theme preference exists in localStorage
    if (typeof window === "undefined") return false;
    let savedTheme: string | null = null;
    try { savedTheme = localStorage.getItem("darkMode"); } catch { /* Private browsers may deny storage. */ }
    if (savedTheme !== null) {
      return savedTheme === "true";
    }
    
    // The public site deliberately opens in the bright theme. Visitors can
    // still choose dark mode, and that explicit choice is remembered.
    return false;
  };

  const [isDarkMode, setIsDarkMode] = useState<boolean>(getInitialTheme);

  // Apply theme class to document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    
    // Save preference to localStorage
    try { localStorage.setItem("darkMode", isDarkMode.toString()); } catch { /* Theme still works without persistence. */ }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode((prevMode) => !prevMode);
  };

  return { isDarkMode, toggleTheme };
};

export default useTheme;
