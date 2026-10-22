const test = require('node:test');
const assert = require('node:assert/strict');
process.env.VERCEL = '1';
delete process.env.MONGODB_URI;
const app = require('../../app');
test('Vercel entry serves pages without a database and fails API requests promptly', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/login', '/dashboard', '/static/css/style.css', '/static/js/app.js']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.ok((await response.text()).length > 100, route);
    }
    assert.deepEqual(await (await fetch(base + '/api/health')).json(), { status: 'ok' });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(base + '/api/v1/invoices');
      assert.equal(response.status, 503);
      assert.match((await response.json()).detail, /MONGODB_URI/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
