import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";

function AppShell() {
  const { theme } = useTheme();
  return (
    <TooltipProvider>
      <Toaster position="bottom-right" theme={theme} />
      <Home />
    </TooltipProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <AppShell />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
