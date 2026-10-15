import Moon from 'lucide-react/dist/esm/icons/moon.js';
import Sun from 'lucide-react/dist/esm/icons/sun.js';
import { Button } from "./ui/button"
import { useTheme } from "./theme-provider"

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme()

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={resolvedTheme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
    >
      {resolvedTheme === "light" ? (
        <Moon className="size-5" aria-hidden="true" />
      ) : (
        <Sun className="size-5" aria-hidden="true" />
      )}
    </Button>
  )
}
