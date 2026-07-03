'use client';

import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { Toaster } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} themes={['light', 'dark']} disableTransitionOnChange>
      <TooltipProvider delayDuration={220} skipDelayDuration={80}>
        {children}
        <Toaster
          closeButton
          expand
          gap={10}
          offset="1rem"
          position="bottom-right"
          toastOptions={{
            duration: 3600,
            classNames: {
              toast: 'arubot-toast',
              title: 'arubot-toast-title',
              description: 'arubot-toast-description',
              actionButton: 'arubot-toast-action',
              cancelButton: 'arubot-toast-cancel',
              closeButton: 'arubot-toast-close',
              icon: 'arubot-toast-icon',
              success: 'arubot-toast-success',
              error: 'arubot-toast-error',
              warning: 'arubot-toast-warning',
              info: 'arubot-toast-info',
            },
          }}
          icons={{
            success: <CheckCircle2 className="h-4 w-4" />,
            error: <XCircle className="h-4 w-4" />,
            warning: <AlertTriangle className="h-4 w-4" />,
            info: <Info className="h-4 w-4" />,
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
