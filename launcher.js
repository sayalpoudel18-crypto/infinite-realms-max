const fs = require('fs');
const vm = require('vm');

let source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const startMarker = 'const HTML = String.raw`';
const endMarker = '`;\nconst MANIFEST=';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start + startMarker.length);

if (start < 0 || end < 0) {
  throw new Error('Could not locate embedded HTML block in server.js');
}

const html = source.slice(start + startMarker.length, end);
source = source.slice(0, start) + 'const HTML = ' + JSON.stringify(html) + ';\nconst MANIFEST=' + source.slice(end + endMarker.length);

vm.runInThisContext(source, { filename: 'server.runtime.js' });
