import './feedback.css';

// Track each operation separately so overlapping requests cannot hide each other.
const pending = new Map();
let indicator, hideTimer, toastTimer, toastRemoveTimer;

function renderLoading() {
  clearTimeout(hideTimer);
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'operation-loading';
    indicator.className = 'operation-loading';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-atomic', 'true');
    indicator.innerHTML = '<span class="loading-spinner" aria-hidden="true"></span><span class="loading-label"></span><span class="loading-track" aria-hidden="true"></span>';
    document.body.append(indicator);
  }
  if (pending.size) {
    indicator.querySelector('.loading-label').textContent = [...pending.values()].at(-1);
    indicator.classList.add('is-visible');
  } else {
    indicator.classList.remove('is-visible');
    hideTimer = setTimeout(() => {
      indicator?.remove();
      indicator = null;
    }, 200);
  }
}

export function beginLoading(label = 'Loading data…') {
  const id = Symbol();
  pending.set(id, label);
  renderLoading();
  return () => {
    if (pending.delete(id)) renderLoading();
  };
}

export async function withLoading(label, operation) {
  const finish = beginLoading(label);
  try {
    return await operation();
  } finally {
    finish();
  }
}

export function requestLabel(path, options = {}) {
  if (path === '/login') return 'Signing in…';
  if (path === '/logout') return 'Signing out…';
  if (path.endsWith('/points')) return 'Syncing patrol data…';
  if (options.method === 'DELETE') return 'Removing checkpoint…';
  if (options.method && options.method !== 'GET') {
    if (path.endsWith('/photos')) return 'Saving photo…';
    if (path.endsWith('/end')) return 'Saving shift…';
    if (path === '/guards') return 'Creating officer account…';
    if (path === '/shifts') return 'Starting shift…';
    return 'Saving changes…';
  }
  return path.endsWith('/photos') ? 'Loading patrol photos…' : 'Loading data…';
}

export function toast(message, success = false) {
  clearTimeout(toastTimer);
  clearTimeout(toastRemoveTimer);
  document.querySelector('#toast')?.remove();
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = `feedback-toast${success ? ' feedback-success' : ''}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  if (success) {
    const mark = document.createElement('span');
    mark.className = 'success-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '✓';
    el.append(mark);
  }
  const copy = document.createElement('div');
  if (success) {
    const title = document.createElement('strong');
    title.textContent = 'Saved successfully';
    copy.append(title);
  }
  const detail = document.createElement('span');
  detail.textContent = message;
  copy.append(detail);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'feedback-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  const dismiss = () => {
    clearTimeout(toastTimer);
    el.classList.add('is-leaving');
    toastRemoveTimer = setTimeout(() => el.remove(), 200);
  };
  close.onclick = dismiss;
  el.append(copy, close);
  document.body.append(el);
  toastTimer = setTimeout(dismiss, 5500);
}

export const successToast = message => toast(message, true);
