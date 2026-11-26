// Sert le dépôt entier en local, pour que la doc puisse relier ses extraits aux fichiers de examples/.
// Usage : npm run docs (port 5174, ou PORT=…)
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
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Introuvable');
    return;
  }
  // Les sources (.ts, .json…) s'affichent en texte brut dans le navigateur.
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain; charset=utf-8' });
  createReadStream(file).pipe(response);
}).listen(PORT, () => console.log(`Documentation sur http://localhost:${PORT}/docs/`));
