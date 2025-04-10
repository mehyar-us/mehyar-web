import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

interface ThemeToggleProps {
  isMobile?: boolean;
}

const ThemeToggle = ({ isMobile = false }: ThemeToggleProps) => {
  const { isDarkMode, toggleTheme } = useTheme();

  if (isMobile) {
    return (
      <button
        onClick={toggleTheme}
        className="flex items-center w-full text-left font-medium text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors rounded-md"
      >
        {isDarkMode ? (
          <>
            <Sun className="mr-2 h-4 w-4" />
            <span>Light Mode</span>
          </>
        ) : (
          <>
            <Moon className="mr-2 h-4 w-4" />
            <span>Dark Mode</span>
          </>
        )}
      </button>
    );
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      className="rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700"
    >
      {isDarkMode ? (
        <Sun className="h-5 w-5" />
      ) : (
        <Moon className="h-5 w-5" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};

export default ThemeToggle;
