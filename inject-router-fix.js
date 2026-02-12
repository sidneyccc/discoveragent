const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Script to inject before React loads to fix routing
const routerFixScript = `
<script>
  // Fix Expo Router for GitHub Pages subdirectory - comprehensive approach
  (function() {
    var basePath = '/discoveragent';
    var currentPath = window.location.pathname;

    // If we're in the subdirectory, handle routing
    if (currentPath.startsWith(basePath)) {
      var routePath = currentPath.substring(basePath.length) || '/';

      // Store for later use
      window.__EXPO_BASE_PATH__ = basePath;
      window.__EXPO_ROUTER_BASE_PATH__ = basePath;

      // Override location.pathname getter to return path without base
      var originalPathname = window.location.pathname;
      Object.defineProperty(window.location, 'pathname', {
        get: function() {
          var fullPath = originalPathname;
          if (history.state && history.state.__internalPath) {
            fullPath = history.state.__internalPath;
          }
          if (fullPath.startsWith(basePath)) {
            return fullPath.substring(basePath.length) || '/';
          }
          return fullPath;
        },
        set: function(value) {
          originalPathname = value;
        }
      });

      // Intercept history methods to handle base path
      var originalPushState = history.pushState;
      var originalReplaceState = history.replaceState;

      history.pushState = function(state, title, url) {
        if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath) && !url.startsWith('http')) {
          var fullUrl = basePath + url;
          state = state || {};
          state.__internalPath = fullUrl;
          return originalPushState.call(this, state, title, fullUrl);
        }
        return originalPushState.call(this, state, title, url);
      };

      history.replaceState = function(state, title, url) {
        if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath) && !url.startsWith('http')) {
          var fullUrl = basePath + url;
          state = state || {};
          state.__internalPath = fullUrl;
          return originalReplaceState.call(this, state, title, fullUrl);
        }
        return originalReplaceState.call(this, state, title, url);
      };

      // Set initial history state
      history.replaceState(
        { __internalPath: originalPathname },
        document.title,
        originalPathname
      );
    }
  })();
</script>`;

function injectScript(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Inject before the first script tag
  if (!content.includes('__EXPO_BASE_PATH__')) {
    content = content.replace(/<script/, routerFixScript + '\n<script');
    fs.writeFileSync(filePath, content);
    console.log(`Injected router fix into: ${path.basename(filePath)}`);
  }
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (path.extname(file) === '.html') {
      injectScript(filePath);
    }
  });
}

console.log('Injecting router fix into HTML files...');
processDirectory(distDir);
console.log('Done!');
