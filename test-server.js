const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const port = 20000 + (process.pid % 10000);
const baseUrl = `http://127.0.0.1:${port}`;

async function waitUntilReady(child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server berhenti dengan kode ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server tidak siap dalam 4 detik');
}

test('Render web service HTTP contract', async t => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  t.after(() => child.kill());
  await waitUntilReady(child);

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /^text\/html/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await home.text(), /Smart Pot/i);

  const script = await fetch(`${baseUrl}/dashboard.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  const scriptBody = await script.text();
  assert.doesNotMatch(scriptBody, /thingspeak/i);
  assert.doesNotMatch(scriptBody, /\bconst\s+supabase\s*=/);
  assert.match(scriptBody, /\bconst\s+supabaseClient\s*=/);

  assert.equal((await fetch(`${baseUrl}/missing`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/`, { method: 'POST' })).status, 405);
});
