import { defineApp } from 'convex/server';
import staticHosting from '@convex-dev/static-hosting/convex.config';

// "Component owns root" mode: the static site is served from /, and any Convex
// HTTP actions we add later live under /api. The built www bundle is uploaded
// with `npm run deploy:convex` (see www/convex/README.md).
const app = defineApp({ httpPrefix: '/api' });
app.use(staticHosting, { httpPrefix: '/' });

export default app;
