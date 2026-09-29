import {defineConfig} from 'vite';
export default defineConfig(({mode}) => ({
  define: mode === 'legacy' ? {'import.meta.env.VITE_BACKEND':JSON.stringify('legacy')} : {},
  build: {rollupOptions:{output:{manualChunks(id) {
    if (id.includes('/node_modules/@firebase/firestore/')) return 'firebase-firestore';
    if (id.includes('/node_modules/@firebase/auth/')) return 'firebase-auth';
    if (id.includes('/node_modules/leaflet/')) return 'maps';
  }}}},
}));
