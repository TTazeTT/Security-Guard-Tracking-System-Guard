// Firebase web configuration is public. Access is enforced by Authentication,
// Firestore rules, and the backend. Never put OAuth secrets in VITE_ variables.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBT8fZ2Z0YpM6UD582phCRRcQvCIKzGMP0',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'guard-tracking-system.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'guard-tracking-system',
  messagingSenderId: '1026774331768',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1026774331768:web:695fae42c5d4c7ffce188d',
};
