import { CitadelLogo } from '@/components/brand/CitadelLogo';
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { debugLog } from '@/lib/debug-config';
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { NavigateFunction } from 'react-router';

const NotFound: () => JSX.Element = (): JSX.Element => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const navigate: NavigateFunction = useNavigate();

  useEffect(() => {
    debugLog('NotFound', '404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    // <main>, not <div>: axe reports "Document should have one main landmark"
    // and "All page content should be contained by landmarks" here. A screen
    // reader user navigates by landmark, and on a page whose entire job is to
    // say "this is not the page you wanted", having nothing to jump to is
    // exactly the wrong place to make someone hunt.
    <main className="min-h-dvh flex items-center justify-center bg-background">
      <div className="text-center">
        <CitadelLogo variant="horizontal" height={34} className="mb-6" />
        <h1 className="text-6xl font-bold text-primary-accent mb-4">404</h1>
        <p className="text-xl text-foreground/80 mb-6">Oops! Page not found</p>
        <Button
          onClick={() => navigate('/')}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Return to Home
        </Button>
      </div>
    </main>
  );
};

export default NotFound;

