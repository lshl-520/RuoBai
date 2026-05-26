const DISMISS_PREFIX = 'rb-model-onboarding-dismissed:';

function safeGetItem(storage, key) {
  try {
    return storage?.getItem?.(key) || '';
  } catch {
    return '';
  }
}

function safeSetItem(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch {}
}

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

export function getModelOnboardingDismissKey(username) {
  return `${DISMISS_PREFIX}${String(username || 'guest')}`;
}

export function hasDismissedModelOnboarding(username, storage = globalThis.localStorage) {
  return safeGetItem(storage, getModelOnboardingDismissKey(username)) === '1';
}

export function markModelOnboardingDismissed(username, storage = globalThis.localStorage) {
  safeSetItem(storage, getModelOnboardingDismissKey(username), '1');
}

export function shouldShowModelOnboarding(status, username, storage = globalThis.localStorage) {
  if (!status?.needsOnboarding) {
    return false;
  }

  if (status.activeConfigIsTest && hasDismissedModelOnboarding(username, storage)) {
    return false;
  }

  return true;
}

export function getPreferredInitialRoute(currentHash, status, username, storage = globalThis.localStorage) {
  const currentRoute = String(currentHash || '').replace(/^#/, '') || 'chat';
  if (!['', 'chat', 'me', 'feed', 'roles', 'memory'].includes(currentRoute)) {
    return 'chat';
  }

  if (currentRoute !== 'chat') {
    return currentRoute;
  }

  return shouldShowModelOnboarding(status, username, storage) ? 'me' : 'chat';
}
