const fs = require('fs');
const path = require('path');

const NEW_LIMIT = 120000; // 120k characters (~2000 lines)

const filesToPatch = [
  {
    path: path.join(__dirname, '..', 'node_modules', '@cline', 'core', 'dist', 'index.js'),
    replace: [
      { from: 'var g1=6000,', to: `var g1=${NEW_LIMIT},` }
    ]
  },
  {
    path: path.join(__dirname, '..', 'node_modules', '@cline', 'core', 'dist', 'hub', 'index.js'),
    replace: [
      { from: 'var g1=6000,', to: `var g1=${NEW_LIMIT},` }
    ]
  },
  {
    path: path.join(__dirname, '..', 'node_modules', '@cline', 'core', 'dist', 'hub', 'daemon', 'entry.js'),
    replace: [
      { from: 'var g1=6000,', to: `var g1=${NEW_LIMIT},` }
    ]
  },
  {
    path: path.join(__dirname, '..', 'node_modules', '@cline', 'core', 'dist', 'extensions', 'tools', 'schemas.d.ts'),
    replace: [
      { from: 'export declare const INPUT_ARG_CHAR_LIMIT = 6000;', to: `export declare const INPUT_ARG_CHAR_LIMIT = ${NEW_LIMIT};` }
    ]
  }
];

console.log(`=== Patching @cline/core character limits to ${NEW_LIMIT} ===`);

let patchedAny = false;
for (const file of filesToPatch) {
  if (!fs.existsSync(file.path)) {
    console.warn(`[Warning] File not found to patch: ${file.path}`);
    continue;
  }
  let content = fs.readFileSync(file.path, 'utf8');
  let filePatched = false;
  for (const rep of file.replace) {
    if (content.includes(rep.from)) {
      content = content.replace(rep.from, rep.to);
      filePatched = true;
    }
  }
  if (filePatched) {
    fs.writeFileSync(file.path, content, 'utf8');
    console.log(`[Success] Patched file: ${path.relative(path.join(__dirname, '..'), file.path)}`);
    patchedAny = true;
  } else {
    console.log(`[Info] File already patched or target pattern not found: ${path.relative(path.join(__dirname, '..'), file.path)}`);
  }
}

if (patchedAny) {
  console.log("=== Patching complete ===");
} else {
  console.log("=== No files needed patching ===");
}
