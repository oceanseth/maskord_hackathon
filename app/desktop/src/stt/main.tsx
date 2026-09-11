import { createRoot } from 'react-dom/client';
import { initFirebase } from '@maskord/shared';
import SttHarness from './SttHarness';

initFirebase();

// No StrictMode here on purpose. Its double-mount would open two AssemblyAI
// sessions in a dev server, and this page exists to show exactly one.
createRoot(document.getElementById('root')!).render(<SttHarness />);
