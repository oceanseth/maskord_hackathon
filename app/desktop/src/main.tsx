import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initFirebase } from '@maskord/shared';
import './index.css';
import App from './App';

initFirebase();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
