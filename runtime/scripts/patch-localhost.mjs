import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(
  here,
  '../node_modules/@kobalab/majiang-server/bin/server.js',
);
const source = fs.readFileSync(server, 'utf8');
const original = 'http.listen(port, ()=>{';
const localOnly = "http.listen(port, '127.0.0.1', ()=>{";

if (source.includes(localOnly)) {
  process.exit(0);
}
if (!source.includes(original)) {
  throw new Error(`Cannot find the expected listen call in ${server}`);
}

fs.writeFileSync(server, source.replace(original, localOnly));
console.log('Patched majiang-server to listen on 127.0.0.1 only.');
