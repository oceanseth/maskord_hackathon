/**
 * Firebase project: maskydotnet
 * https://console.firebase.google.com/u/0/project/maskydotnet
 *
 * Shared auth pool: masky.com users can sign into Maskord with the same credentials.
 * To get these values: Firebase Console → Project Settings → General → Your apps → Web app.
 *
 * DO NOT commit real keys — use environment variables in production builds.
 */

export const firebaseConfig = {
  apiKey:            import.meta.env?.VITE_FIREBASE_API_KEY             ?? process.env['FIREBASE_API_KEY']             ?? 'AIzaSyBxDknJ0YcbfGXcrj9aoqyW5UMQm4OhcdI',
  authDomain:        import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN         ?? process.env['FIREBASE_AUTH_DOMAIN']         ?? 'maskydotnet.firebaseapp.com',
  databaseURL:       import.meta.env?.VITE_FIREBASE_DATABASE_URL        ?? process.env['FIREBASE_DATABASE_URL']        ?? 'https://maskydotnet-default-rtdb.firebaseio.com',
  projectId:         import.meta.env?.VITE_FIREBASE_PROJECT_ID          ?? process.env['FIREBASE_PROJECT_ID']          ?? 'maskydotnet',
  storageBucket:     import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET      ?? process.env['FIREBASE_STORAGE_BUCKET']      ?? 'maskydotnet.firebasestorage.app',
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID ?? process.env['FIREBASE_MESSAGING_SENDER_ID'] ?? '253806012115',
  appId:             import.meta.env?.VITE_FIREBASE_APP_ID              ?? process.env['FIREBASE_APP_ID']              ?? '1:253806012115:web:634bb43405ca639401d626',
};
