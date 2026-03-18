import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log('[Client] main.tsx is executing. Frontend JS loaded successfully.');

window.addEventListener('error', (event) => {
  console.error('[Client Error Boundary] Uncaught error:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Client Error Boundary] Unhandled promise rejection:', event.reason);
});

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('[Client] ERROR: Root element not found in the DOM!');
  } else {
    console.log('[Client] Root element found, mounting React app...');
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  }
} catch (error) {
  console.error('[Client] ERROR during React mount:', error);
}
