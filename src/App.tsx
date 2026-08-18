import { useState } from 'react';

import { ThemeToggle } from '@/components/common/theme-toggle';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';

function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">MadMusic</h1>
        <p className="text-sm text-muted-foreground">
          One music library, every device.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={() => setCount((c) => c + 1)}>count is {count}</Button>
        <ThemeToggle />
      </div>

      <Toaster />
    </div>
  );
}

export default App;
