// Serves the whole repository locally, so the docs can link their excerpts to the files in examples/.
// Usage: npm run docs (port 5174, or PORT=…)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 5174);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/') {
    response.writeHead(302, { location: '/docs/' }).end();
    return;
  }
  let file = join(ROOT, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file) || path.includes('node_modules')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  // Sources (.ts, .json…) are shown as plain text in the browser.
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain; charset=utf-8' });
  createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`Documentation at http://localhost:${PORT}/docs/`));
