// Starts headless Chrome or Edge and gives a small remote control for one page (DevTools protocol, no packages).
// Used by run-headless.mjs (the feature tests) and layout-check.mjs (every screen at many sizes).
// Nothing here is shipped with the app.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];

export const launch = async ({ width = 375, height = 812 } = {}) => {
    const exe = BROWSERS.filter(Boolean).find((p) => existsSync(p));
    if (!exe) throw new Error('No Chrome or Edge found. Set CHROME_PATH to the browser.');
    const profile = mkdtempSync(join(tmpdir(), 'app-tests-'));
    const browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
        '--disable-extensions', '--mute-audio', '--hide-scrollbars', `--window-size=${width},${height}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const close = () => new Promise((resolve) => {
        try { browser.kill(); } catch (e) { /* already gone */ }
        setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* the browser may still hold a file */ } resolve(); }, 500);
    });
    let port;
    try {
        port = await new Promise((resolve, reject) => {
            let err = '';
            browser.stderr.on('data', (d) => { err += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(err); if (m) resolve(m[1]); });
            browser.on('exit', () => reject(new Error(`the browser closed before it was ready\n${err.slice(0, 600)}`)));
            setTimeout(() => reject(new Error('the browser did not start in 20 s')), 20000);
        });
    } catch (e) { await close(); throw e; }

    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let nextId = 0;
    const waiting = new Map();
    const listeners = new Map();
    const pageErrors = [];
    ws.addEventListener('message', (m) => {
        const d = JSON.parse(m.data);
        if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
        if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
        if (d.method && listeners.has(d.method)) { listeners.get(d.method).forEach((fn) => fn(d.params)); listeners.delete(d.method); }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        waiting.set(id, (d) => (d.error ? reject(new Error(`${method}: ${d.error.message}`)) : resolve(d.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });
    const once = (method, ms = 30000) => new Promise((resolve) => {
        listeners.set(method, (listeners.get(method) || []).concat(resolve));
        setTimeout(resolve, ms);
    });
    // Runs JavaScript in the page; a promise is waited for, the value comes back as plain data.
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
    };
    // Phone sizes are emulated as a touch phone, wider ones as a desktop window.
    const setSize = async (w, h, { dark = true } = {}) => {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: w < 768 ? 2 : 1, mobile: w < 768 });
        await send('Emulation.setTouchEmulationEnabled', { enabled: w < 768 });
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    };
    const open = async (url) => {
        const loaded = once('Page.loadEventFired');
        await send('Page.navigate', { url });
        await loaded;
    };
    const screenshot = async (file) => {
        const r = await send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(r.data, 'base64'));
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await setSize(width, height);
    return { send, evaluate, setSize, open, screenshot, close, pageErrors };
};

// Waits until the app's script has run.
export const APP_READY = `new Promise((done) => { const t0 = Date.now(); const tick = () => ((typeof parseBankSms === 'function' && typeof state === 'object') || Date.now() - t0 > 15000 ? done(typeof state === 'object') : setTimeout(tick, 100)); tick(); })`;
