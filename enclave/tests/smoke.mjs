import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { firefox } from 'playwright-core';

const executablePath = process.env.ENCLAVE_BROWSER_EXECUTABLE;
if (!executablePath) throw new Error('Set ENCLAVE_BROWSER_EXECUTABLE to the built Enclave Browser');
const artifacts = path.resolve(process.env.ENCLAVE_TEST_ARTIFACTS || 'artifacts');
await fs.mkdir(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url === '/download') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=example.txt' });
    return res.end('enclave download');
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><title>Enclave Browser qualification</title>
    <label>Name <input id="name"></label><button onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Submit</button>
    <output id="result"></output><a href="/download">Download</a>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;
let browser;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); }
}
try {
  browser = await firefox.launch({ executablePath, headless: true, timeout: 60000,
    env: { ...process.env, ENCLAVE_BROWSER_AUTOMATION: '1' } });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await check('page interaction and screenshot', async () => {
    await page.goto(origin);
    assert.equal(await page.title(), 'Enclave Browser qualification');
    await page.getByLabel('Name').fill('Enclave');
    await page.getByRole('button', { name: 'Submit' }).click();
    assert.equal(await page.locator('#result').textContent(), 'Enclave');
    await page.screenshot({ path: path.join(artifacts, 'page.png') });
  });
  await check('context cookies stay separate', async () => {
    const other = await browser.newContext();
    try {
      await context.addCookies([{ name: 'private', value: 'first', url: origin }]);
      assert.equal((await other.cookies(origin)).length, 0);
    } finally { await other.close(); }
  });
  await check('network interception', async () => {
    await page.route('**/routed', route => route.fulfill({ body: 'intercepted', contentType: 'text/plain' }));
    assert.equal(await page.evaluate(() => fetch('/routed').then(r => r.text())), 'intercepted');
  });
  await check('download', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download' }).click()]);
    assert.equal(download.suggestedFilename(), 'example.txt');
    const location = await download.path();
    assert.equal(await fs.readFile(location, 'utf8'), 'enclave download');
  });
  await check('cross-site iframe with site isolation retained', async () => {
    await page.evaluate(url => { const frame = document.createElement('iframe'); frame.src = url; document.body.append(frame); }, `http://localhost:${port}/frame`);
    console.log('Frame tree before iframe interaction:', page.frames().map(f => ({ url: f.url(), parent: f.parentFrame()?.url() })));
    const frame = page.frameLocator('iframe');
    await frame.getByLabel('Name').fill('isolated frame');
    assert.equal(await frame.getByLabel('Name').inputValue(), 'isolated frame');
    await frame.getByRole('button', { name: 'Submit' }).click();
    assert.equal(await frame.locator('#result').textContent(), 'isolated frame');
  });
  await check('TLS bypass is rejected', () => assert.rejects(browser.newContext({ ignoreHTTPSErrors: true }), /Enclave Browser policy forbids/));
  await check('CSP bypass is rejected', () => assert.rejects(browser.newContext({ bypassCSP: true }), /Enclave Browser policy forbids/));
} catch (error) {
  results.push({ name: 'browser startup', passed: false, error: error.stack });
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
  await fs.writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2) + '\n');
}
console.log(JSON.stringify(results, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
