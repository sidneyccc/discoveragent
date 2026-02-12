const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

// Icon font CDN links
const iconFonts = `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.4/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf" as="font" crossorigin>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.4/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf" as="font" crossorigin>
  <style>
    @font-face {
      font-family: 'FontAwesome';
      src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.4/build/vendor/react-native-vector-icons/Fonts/FontAwesome.ttf') format('truetype');
    }
    @font-face {
      font-family: 'MaterialCommunityIcons';
      src: url('https://cdn.jsdelivr.net/npm/@expo/vector-icons@14.0.4/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf') format('truetype');
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
