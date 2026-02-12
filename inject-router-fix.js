const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Simpler script - just intercept history for navigation
const routerFixScript = `
<script>
  (function() {
    var basePath = '/discoveragent';

    // Only intercept history methods for navigation
    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function(state, title, url) {
      if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath) && !url.startsWith('http')) {
        url = basePath + url;
      }
      return originalPushState.call(this, state, title, url);
    };

    history.replaceState = function(state, title, url) {
      if (url && typeof url === 'string' && url.startsWith('/') && !url.startsWith(basePath) && !url.startsWith('http')) {
        url = basePath + url;
      }
      return originalReplaceState.call(this, state, title, url);
    };

    // Intercept link clicks
    document.addEventListener('click', function(e) {
      var target = e.target;
      while (target && target.tagName !== 'A') {
        target = target.parentElement;
      }
      if (target && target.tagName === 'A') {
        var href = target.getAttribute('href');
        if (href && href.startsWith('/') && !href.startsWith(basePath) && !href.startsWith('http')) {
          target.setAttribute('href', basePath + href);
        }
      }
    });
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
