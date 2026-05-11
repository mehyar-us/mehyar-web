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
        className="flex w-full items-center rounded-xl px-3 py-2 text-left font-medium text-ink/78 transition-colors hover:bg-brand-100 hover:text-brand-900 dark:text-white/78 dark:hover:bg-brand-900 dark:hover:text-white"
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
      className="rounded-xl bg-white/70 hover:bg-brand-100 dark:bg-brand-900 dark:hover:bg-brand-800"
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
