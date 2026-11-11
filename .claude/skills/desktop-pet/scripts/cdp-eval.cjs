// usage: node cdp-eval.cjs "<expression>"  — evaluates in the pet window (index.html) over CDP port 9333
(async () => {
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find((t) => t.url.endsWith('index.html'));
  if (!page) throw new Error('pet window not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () =>
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: process.argv[2] } }));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== 1) return;
    console.log(JSON.stringify(msg.result?.result?.value ?? msg.result));
    ws.close();
  };
})().catch((err) => {
  console.error(String(err));
  process.exit(1);
});
