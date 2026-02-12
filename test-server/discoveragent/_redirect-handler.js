// Handle redirect from 404 page
(function() {
  const redirect = sessionStorage.getItem('redirect');
  if (redirect) {
    sessionStorage.removeItem('redirect');
    const path = redirect.replace('/discoveragent', '');
    if (path && path !== '/' && window.history && window.history.replaceState) {
      window.history.replaceState(null, '', '/discoveragent' + path);
    }
  }
})();
