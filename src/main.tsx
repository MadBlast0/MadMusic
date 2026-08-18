import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { Providers } from '@/components/common/providers';
import '@/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
