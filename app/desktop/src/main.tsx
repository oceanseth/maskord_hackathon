import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConvexProvider } from 'convex/react';
import { initFirebase } from '@maskord/shared';
import './index.css';
import App from './App';
import { convex } from './rooms/convex';

initFirebase();

// The same client the game rooms use. The client app needs it now that Maskord
// Pro lives in User Settings: the rent-out shelf is Convex data, and a
// `useQuery` with no provider above it throws rather than degrading.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
