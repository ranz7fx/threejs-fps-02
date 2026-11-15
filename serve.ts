// Tiny static server for play-testing the game in game/.
//
// Serves the game directory over HTTP so game/index.html can be opened
// in a desktop browser at http://localhost:8080 (or --port <n>).
// Standard library only; no build step:
//   node serve.ts [--port 8080] [--root game]
//
// Only files inside the game directory are ever served: any request
// path that escapes it (including ".." segments and encoded slashes)
// gets a 403, and anything that is not a regular file gets a 404.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.glsl': 'text/plain; charset=utf-8',
  '.vert': 'text/plain; charset=utf-8',
  '.frag': 'text/plain; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function parseArgs(argv: string[]): { port: number; root: string } {
  let port = 8080;
  let root = 'game';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' && argv[i + 1] !== undefined) {
      port = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--root' && argv[i + 1] !== undefined) {
      root = argv[i + 1];
      i += 1;
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be an integer between 1 and 65535, not ${String(port)}`);
  }
  return { port, root };
}

const repoRoot = resolve(process.cwd());
const { port, root } = parseArgs(process.argv.slice(2));
const gameRoot = resolve(repoRoot, root);

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // Decode %2e / %2f etc. first so an encoded escape cannot slip past.
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const filePath = resolve(gameRoot, `.${sep}${normalize(pathname)}`);
    if (filePath !== gameRoot && !filePath.startsWith(`${gameRoot}${sep}`)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('403 forbidden: path outside game/\n');
      return;
    }
    const stat = statSync(filePath, { throwIfNoEntry: false });
    if (stat === undefined || !stat.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('404 not found\n');
      return;
    }
    const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type, 'content-length': stat.size });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(`500 internal error: ${error instanceof Error ? error.message : String(error)}\n`);
  }
});

server.listen(port, () => {
  console.log(`serving ${gameRoot} at http://localhost:${port}/`);
});
