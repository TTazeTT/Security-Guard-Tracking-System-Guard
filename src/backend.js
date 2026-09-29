import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserSessionPersistence, signInWithEmailAndPassword, signOut, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit, startAfter, connectFirestoreEmulator } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';
import { bridgeRequest, bridgeConfigured } from './bridge';

export const isFirebase = import.meta.env.VITE_BACKEND !== 'legacy';
const legacyApi = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const app = isFirebase ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;
if (app && import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true' && ['localhost','127.0.0.1'].includes(location.hostname)) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings:true});
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
const ready = auth ? setPersistence(auth, browserSessionPersistence).then(() => auth.authStateReady()) : Promise.resolve();
let profile, stops = [], snapshotError, historySize = 50, historyCursor, historyFull = false;
let checkpoints = [], guards = [], recent = [], live = [], older = [], drive = {connected: false};
const routes = new Map();

function reset() {
  stops.forEach(stop => stop()); stops = [];
  profile = null; snapshotError = null; routes.clear();
  checkpoints = []; guards = []; recent = []; live = []; older = [];
  drive = {connected: false}; historyCursor = null; historyFull = false;
}

function listen(target, assign) {
  return new Promise((resolve, reject) => {
    let first = true;
    stops.push(onSnapshot(target, snapshot => {
      assign(snapshot); if (first) { first = false; resolve(); }
    }, error => { snapshotError = error; if (first) reject(error); }));
  });
}
const values = snapshot => snapshot.docs.map(d => ({...d.data(), id: d.id}));
const userConstraints = () => profile.role === 'guard' ? [where('guardId', '==', profile.id)] : [];

async function startSession() {
  if (!auth.currentUser) throw Object.assign(new Error('Please sign in again.'), {status: 401});
  if (profile?.id === auth.currentUser.uid) return profile;
  reset();
  const record = await getDoc(doc(db, 'users', auth.currentUser.uid));
  if (!record.exists() || record.data().disabled || !['admin','guard'].includes(record.data().role)) {
    await signOut(auth);
    throw new Error('This account has not been approved for patrol access. Contact the property administrator.');
  }
  profile = {...record.data(), id: record.id};
  await Promise.all([
    listen(collection(db, 'checkpoints'), s => { checkpoints = values(s); }),
    listen(query(collection(db, 'shifts'), ...userConstraints(), orderBy('startedAt', 'desc'), limit(historySize)), s => {
      recent = values(s);
      if (!older.length) { historyCursor = s.docs.at(-1); historyFull = s.size === historySize; }
    }),
    listen(query(collection(db, 'shifts'), ...userConstraints(), where('endedAt', '==', null)), s => { live = values(s); }),
    listen(doc(db, 'settings', 'drive'), s => { drive = s.exists() ? {...drive, ...s.data()} : {connected: false}; }),
    ...(profile.role === 'admin' ? [listen(query(collection(db, 'users'), where('role', '==', 'guard')), s => { guards = values(s); })] : []),
  ]);
  return profile;
}

async function routeFor(shift) {
  let cached = routes.get(shift.id) || {count: 0, points: [], pending: null};
  routes.set(shift.id, cached);
  if (cached.pending) await cached.pending;
  if (cached.count < (shift.routeBatchCount || 0)) {
    cached.pending = (async () => {
      const batches = await getDocs(query(collection(db, 'shifts', shift.id, 'routeBatches'), where('sequence', '>=', cached.count), orderBy('sequence')));
      for (const batch of batches.docs) {
        const data = batch.data();
        if (data.sequence !== cached.count) throw new Error('Some route records are missing. Retry loading this report.');
        cached.points.push(...data.points); cached.count++;
      }
    })();
    try { await cached.pending; } finally { cached.pending = null; }
  }
  return {...shift, points: cached.points};
}

async function rpc(action, data = {}) {
  await ready;
  if (!auth.currentUser) throw Object.assign(new Error('Please sign in again.'), {status: 401});
  return bridgeRequest({action, data, idToken: await auth.currentUser.getIdToken()});
}

function rememberShift(shift) {
  recent = [...new Map([...recent, shift].map(s => [s.id,s])).values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  live = live.filter(s => s.id !== shift.id);
  if (!shift.endedAt) live.push(shift);
  return shift;
}

export async function restoreSession() {
  if (!isFirebase) return Boolean(sessionStorage.getItem('patrol-token'));
  await ready;
  return Boolean(auth.currentUser);
}

export function driveStatus() { return { ...drive, configured: bridgeConfigured() }; }
export function hasMoreHistory() { return isFirebase && historyFull; }
export async function loadMoreHistory() {
  if (!historyCursor || !historyFull) return;
  const result = await getDocs(query(collection(db, 'shifts'), ...userConstraints(), orderBy('startedAt', 'desc'), startAfter(historyCursor), limit(historySize)));
  older.push(...values(result)); historyCursor = result.docs.at(-1); historyFull = result.size === historySize;
}

export async function connectDrive(popup) {
  try {
    const {url} = await rpc('drive/connect', {origin: location.origin});
    if (!popup || popup.closed) throw new Error('Allow popups, then select Connect Google Drive again.');
    popup.location.replace(url);
  } catch (error) { popup?.close(); throw error; }
}
export async function checkDrive() {
  const status = await rpc('drive/status');
  drive = {...drive, ...status}; return status;
}

export async function request(path, options = {}) {
  if (!isFirebase) {
    const response = await fetch(legacyApi + path, {...options, headers: {'Content-Type':'application/json', Authorization:`Bearer ${sessionStorage.getItem('patrol-token') || ''}`, ...options.headers}});
    const data = await response.json().catch(() => ({error:'The server returned an invalid response.'}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), {status: response.status});
    return data;
  }
  await ready;
  const body = options.body ? JSON.parse(options.body) : {};
  const method = options.method || 'GET';
  if (path === '/login') {
    try {
      await signInWithEmailAndPassword(auth, body.email, body.password);
      const user = await startSession();
      return {token: 'firebase-session', user};
    } catch (error) {
      reset(); await signOut(auth);
      if (['auth/invalid-credential','auth/user-not-found','auth/wrong-password'].includes(error.code)) throw new Error('Email or password is incorrect.');
      throw error;
    }
  }
  if (path === '/logout') { reset(); await signOut(auth); return {ok: true}; }
  const user = await startSession();
  if (snapshotError) throw snapshotError;
  if (path === '/me') return user;
  if (path === '/checkpoints' && method === 'GET') return checkpoints;
  if (path === '/guards' && method === 'GET') return guards;
  if (path === '/shifts' && method === 'GET') {
    const merged = [...new Map([...older, ...recent, ...live].map(s => [s.id, s])).values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
    return Promise.all(merged.map(s => s.endedAt ? {...s, points: routes.get(s.id)?.points || []} : routeFor(s)));
  }
  const match = path.match(/^\/shifts\/([\w-]+)(?:\/(points|end|photos))?$/);
  if (match) {
    const [,id,action] = match;
    if (!action && method === 'GET') {
      const record = await getDoc(doc(db, 'shifts', id));
      if (!record.exists()) throw new Error('Shift not found.');
      return routeFor({...record.data(), id});
    }
    if (action === 'photos' && method === 'GET') {
      const list = values(await getDocs(query(collection(db, 'shifts', id, 'photos'), orderBy('capturedAt'))));
      // One image at a time avoids overwhelming Apps Script and browser memory.
      const result = [];
      for (const photo of list) {
        if (photo.migrationPending) throw new Error('Photo migration is pending. Ask your administrator to finish the migration after connecting Drive.');
        const {image} = await rpc('photos/read', {shiftId: id, photoId: photo.id});
        result.push({...photo, image});
      }
      return result;
    }
    const result = await rpc(`shifts/${action}`, {...body, shiftId: id});
    return action === 'photos' ? result : routeFor(rememberShift(result));
  }
  if (path.startsWith('/checkpoints/') && method === 'DELETE') return rpc('checkpoints/delete', {id: path.split('/').at(-1)});
  if (path === '/checkpoints') return rpc('checkpoints/create', body);
  if (path === '/guards') return rpc('guards/create', body);
  if (path === '/shifts') return routeFor(rememberShift(await rpc('shifts/start', body)));
  throw new Error('Unknown patrol request.');
}
