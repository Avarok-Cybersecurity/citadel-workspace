import React, { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Button } from './button';
import { useWorkspace } from '@/contexts/WorkspaceContext';

export const ErrorDisplay: React.FC = () => {
  const { state } = useWorkspace();
  const [visible, setVisible] = useState(false);

  // Show error when it appears, hide after 5 seconds
  useEffect(() => {
    if (state.error) {
      setVisible(true);
      
      // Auto-dismiss after 5 seconds
      const timer: NodeJS.Timeout = setTimeout((): void => {
        setVisible(false);
      }, 5000);
      
      return (): void => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [state.error]);
  
  if (!state.error || !visible) {
    return null;
  }
  
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <Alert variant="destructive" className="shadow-lg">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{state.error}</AlertDescription>
        <Button 
          variant="ghost" 
          size="icon" 
          className="absolute top-2 right-2"
          aria-label="Dismiss error"
          onClick={() => setVisible(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </Alert>
    </div>
  );
};
