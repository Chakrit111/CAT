// Test stand-in for GitHub Releases. usage: node upd-server.cjs <file to serve as the new exe> <port> [bad]
// "bad" serves a checksum that does not match, to see the updater refuse the download.
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const [file, port, bad] = process.argv.slice(2);
const data = fs.readFileSync(file);
const sha = bad ? 'a'.repeat(64) : crypto.createHash('sha256').update(data).digest('hex');
const base = `http://127.0.0.1:${port}/dl/`;
const asset = (name, size) => ({ name, size, browser_download_url: base + name });
const release = (tag, name, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, assets: [asset(name, data.length), asset(name + '.sha256', 80)], ...extra });
const releases = [
  release('donut-cat-v9.9.9', 'Desktop-Pet-9.9.9-portable.exe'), // another pet: ignore
  release('hamster-v1.0.1', 'hamster-1.0.1-portable.exe'),
  release('hamster-v0.9.0', 'hamster-0.9.0-portable.exe'), // older: ignore
  release('hamster-v2.0.0', 'hamster-2.0.0-portable.exe', { draft: true }), // draft: ignore
  { tag_name: 'hamster-v3.0.0', draft: false, prerelease: false, assets: [{ name: 'hamster-3.0.0-portable.exe', size: 1, browser_download_url: 'http://evil.example/x.exe' }, { name: 'hamster-3.0.0-portable.exe.sha256', size: 80, browser_download_url: 'http://evil.example/x.sha256' }] }, // foreign host: ignore
];
http
  .createServer((req, res) => {
    console.log(req.method, req.url, 'UA:', req.headers['user-agent']);
    if (req.url.startsWith('/releases')) return res.end(JSON.stringify(releases));
    if (req.url === '/dl/hamster-1.0.1-portable.exe') return res.end(data);
    if (req.url === '/dl/hamster-1.0.1-portable.exe.sha256') return res.end(`${sha}  hamster-1.0.1-portable.exe\n`);
    res.statusCode = 404;
    res.end('no');
  })
  .listen(Number(port), '127.0.0.1', () => console.log('listening', port));
