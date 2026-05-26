/* ====== Hash Router ====== */
const validPages = ['feed','chat','roles','memory','me'];

export function getCurrentRoute() {
  const hash = location.hash.replace('#','') || 'chat';
  return validPages.includes(hash) ? hash : 'chat';
}

export function navigate(page) {
  if (validPages.includes(page)) {
    location.hash = '#' + page;
  }
}

export function onRouteChange(callback) {
  window.addEventListener('hashchange', () => callback(getCurrentRoute()));
  // Also fire on first load
  callback(getCurrentRoute());
}
