const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Script to inject before React loads to fix routing
const routerFixScript = `
<script>
  // Fix Expo Router for GitHub Pages subdirectory
  (function() {
    var basePath = '/discoveragent';
    var currentPath = window.location.pathname;

    // If we're in the subdirectory, strip it for the router
    if (currentPath.startsWith(basePath)) {
      var routePath = currentPath.substring(basePath.length) || '/';

      // Store original for history
      window.__EXPO_BASE_PATH__ = basePath;

      // Intercept history methods
      var originalPushState = history.pushState;
      var originalReplaceState = history.replaceState;

      history.pushState = function(state, title, url) {
        if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath)) {
          url = basePath + url;
        }
        return originalPushState.call(this, state, title, url);
      };

      history.replaceState = function(state, title, url) {
        if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath)) {
          url = basePath + url;
        }
        return originalReplaceState.call(this, state, title, url);
      };
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
