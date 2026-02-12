const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const basePath = '/discoveragent';

// Function to fix paths in HTML files
function fixPaths(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix href and src paths to include base path
  content = content.replace(/href="\/(?!\/)/g, `href="${basePath}/`);
  content = content.replace(/src="\/(?!\/)/g, `src="${basePath}/`);

  fs.writeFileSync(filePath, content);
  console.log(`Fixed paths in: ${path.basename(filePath)}`);
}

// Find all HTML files in dist
function processDirectory(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      processDirectory(filePath);
    } else if (path.extname(file) === '.html') {
      fixPaths(filePath);
    }
  });
}

console.log('Fixing paths for GitHub Pages...');
processDirectory(distDir);
console.log('Done!');
