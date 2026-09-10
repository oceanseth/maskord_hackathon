/**
 * Firebase project: maskydotnet
 * https://console.firebase.google.com/u/0/project/maskydotnet
 *
 * Shared auth pool: masky.com users can sign into Maskord with the same credentials.
 * To get these values: Firebase Console → Project Settings → General → Your apps → Web app.
 *
 * DO NOT commit real keys — use environment variables in production builds.
 */

// Safely read Vite env vars — works at build time on web (Vite replaces these statically)
// and falls back gracefully on React Native where import.meta.env is unavailable.
const viteEnv: Record<string, string | undefined> = (() => {
  try {
    return (import.meta as any).env ?? {};
  } catch {
    return {};
  }
})();

export const firebaseConfig = {
  apiKey:            viteEnv['VITE_FIREBASE_API_KEY']             ?? process.env['FIREBASE_API_KEY']             ?? 'AIzaSyBxDknJ0YcbfGXcrj9aoqyW5UMQm4OhcdI',
  authDomain:        viteEnv['VITE_FIREBASE_AUTH_DOMAIN']         ?? process.env['FIREBASE_AUTH_DOMAIN']         ?? 'maskydotnet.firebaseapp.com',
  databaseURL:       viteEnv['VITE_FIREBASE_DATABASE_URL']        ?? process.env['FIREBASE_DATABASE_URL']        ?? 'https://maskydotnet-default-rtdb.firebaseio.com',
  projectId:         viteEnv['VITE_FIREBASE_PROJECT_ID']          ?? process.env['FIREBASE_PROJECT_ID']          ?? 'maskydotnet',
  storageBucket:     viteEnv['VITE_FIREBASE_STORAGE_BUCKET']      ?? process.env['FIREBASE_STORAGE_BUCKET']      ?? 'maskydotnet.firebasestorage.app',
  messagingSenderId: viteEnv['VITE_FIREBASE_MESSAGING_SENDER_ID'] ?? process.env['FIREBASE_MESSAGING_SENDER_ID'] ?? '253806012115',
  appId:             viteEnv['VITE_FIREBASE_APP_ID']              ?? process.env['FIREBASE_APP_ID']              ?? '1:253806012115:web:634bb43405ca639401d626',
};
