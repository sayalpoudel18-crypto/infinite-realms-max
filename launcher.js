const fs = require('fs');
const Module = require('module');
const vm = require('vm');

const filename = require.resolve('./server.js');
let source = fs.readFileSync(filename, 'utf8');
const startMarker = 'const HTML = String.raw`';
const endMarker = '</html>`;';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error('Could not locate embedded HTML block in server.js');
}

// Preserve browser backticks, interpolation and escape sequences literally.
// Match the HTML boundary, independent of the next server variable's name.
const html = source.slice(start + startMarker.length, end + '</html>'.length);
for (const [index, match] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].entries()) {
  new vm.Script(match[1], { filename: `rendered-inline-${index + 1}.js` });
}
source = source.slice(0, start) + 'const HTML = ' + JSON.stringify(html) + ';' + source.slice(end + endMarker.length);

// Server code needs CommonJS require, __dirname and exports. A bare VM scope
// does not provide those bindings in a normal `node launcher.js` process.
const runtime = new Module(filename, module);
runtime.filename = filename;
runtime.paths = module.paths;
runtime._compile(source, filename);
module.exports = runtime.exports;
