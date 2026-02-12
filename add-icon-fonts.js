const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Icon font CDN links - using proper web font URLs
const iconFonts = `
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css">
  <style>
    /* Map Expo icon names to web font classes */
    [data-testid*="FontAwesome"] {
      font-family: 'Font Awesome 6 Free', 'Font Awesome 6 Brands' !important;
    }
    [data-testid*="MaterialCommunityIcons"] {
      font-family: 'Material Design Icons' !important;
    }
  </style>`;

function addFontsToHTML(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Add icon fonts before </head>
  if (!content.includes('FontAwesome.ttf')) {
    content = content.replace('</head>', `${iconFonts}\n</head>`);
    fs.writeFileSync(filePath, content);
    console.log(`Added icon fonts to: ${path.basename(filePath)}`);
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
      addFontsToHTML(filePath);
    }
  });
}

console.log('Adding icon fonts to HTML files...');
processDirectory(distDir);
console.log('Done!');
