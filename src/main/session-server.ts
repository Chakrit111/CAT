import { createServer, type Server } from 'node:http';

/** A hook report is a handful of short fields; anything bigger is not one. */
const MAX_BODY = 16 * 1024;

/**
 * Listens on this machine only for the reports of Claude Code's hooks: `POST /event` with a JSON
 * body (scripts/claude-hook.mjs sends them). Nothing is ever sent back but a status code.
 *
 * A web page open in a browser could also reach a local port, so a request must be one a page
 * cannot make without asking first (a JSON content type) and must not come with an Origin.
 *
 * @param onFail the port could not be opened, e.g. another pet already has it
 */
export function listenForReports(port: number, onReport: (report: unknown) => void, onFail: (err: Error) => void): Server {
  const server = createServer((req, res) => {
    const reply = (status: number): void => {
      res.writeHead(status, { 'Content-Length': 0, Connection: 'close' });
      res.end();
    };
    const json = (req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json');
    if (req.method !== 'POST' || req.url !== '/event') return reply(404);
    if (!json || req.headers['origin'] !== undefined) return reply(403);

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reply(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      let report: unknown;
      try {
        report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(400);
      }
      reply(204);
      onReport(report);
    });
    req.on('error', () => undefined);
  });
  server.on('error', onFail);
  server.listen(port, '127.0.0.1');
  return server;
}
