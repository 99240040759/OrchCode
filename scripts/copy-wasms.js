const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '../node_modules/tree-sitter-wasms/out');
const dest = path.join(__dirname, '../resources/wasms');

if (!fs.existsSync(src)) {
  console.error(`WASM source directory not found: ${src}`);
  process.exit(1);
}

if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest, { recursive: true });
}

const files = fs.readdirSync(src);
for (const file of files) {
  if (file.endsWith('.wasm')) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}
console.log(`Successfully copied ${files.length} WASM files to resources/wasms`);
