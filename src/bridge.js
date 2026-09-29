// Apps Script's HTML bridge avoids cross-origin POST/preflight restrictions.
// Only the sandbox that knows this page's random nonce can establish a channel.
let connection;
const pending = new Map();
const CHANNEL = 'solymar-patrol-v1';
const endpoint = import.meta.env.VITE_APPS_SCRIPT_URL;

export function bridgeConfigured() { return Boolean(endpoint); }

function connect() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    if (!endpoint) return reject(new Error('The patrol backend is not configured. Complete the setup in README.md.'));
    const url = new URL(endpoint);
    if (url.origin !== 'https://script.google.com' || !url.pathname.endsWith('/exec')) {
      return reject(new Error('Use the deployed Apps Script web app URL ending in /exec.'));
    }
    const nonce = crypto.randomUUID();
    url.searchParams.set('parentOrigin', location.origin);
    url.searchParams.set('nonce', nonce);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Patrol service connection';
    let peer;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', receive);
      frame.remove(); connection = null;
      reject(new Error('Cannot connect to the patrol service. Check its deployment access and allowed website origins.'));
    }, 30000);
    function receive(event) {
      const data = event.data;
      if (!data || data.channel !== CHANNEL || data.nonce !== nonce) return;
      let origin;
      try { origin = new URL(event.origin); } catch { return; }
      if (origin.protocol !== 'https:' || !(origin.hostname === 'script.google.com' || origin.hostname.endsWith('.googleusercontent.com'))) return;
      if (data.type === 'ready' && !peer) {
        peer = { source: event.source, origin: event.origin, nonce };
        clearTimeout(timeout); resolve(peer);
      } else if (peer && event.source === peer.source && event.origin === peer.origin && data.type === 'response') {
        const job = pending.get(data.id);
        if (!job) return;
        clearTimeout(job.timeout); pending.delete(data.id);
        if (data.result?.ok) job.resolve(data.result.data);
        else job.reject(Object.assign(new Error(data.result?.error || 'The patrol service could not complete the request.'), {status: data.result?.status}));
      }
    }
    window.addEventListener('message', receive);
    frame.src = url.href;
    document.body.append(frame);
  });
  return connection;
}

export async function bridgeRequest(payload) {
  const peer = await connect();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The request timed out. Keep the photo preview open and retry; an upload with the same ID will not be duplicated.'));
    }, 120000);
    pending.set(id, {resolve, reject, timeout});
    peer.source.postMessage({channel: CHANNEL, nonce: peer.nonce, type: 'request', id, payload}, peer.origin);
  });
}
