// Runs tests/feature-check.js in headless Chrome or Edge at phone size and prints the result.
// The app must be served locally first (any static server on the project folder):
//     node tests/run-headless.mjs [http://localhost:5510/index.html] [--width=375] [--height=812] [--list]
// Exit code 0 when every test passes.
import { launch, APP_READY } from './headless.mjs';

const url = process.argv.slice(2).find((a) => /^https?:/.test(a)) || 'http://localhost:5510/index.html';
const num = (name, def) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? Number(a.split('=')[1]) : def; };
const width = num('width', 375);
const height = num('height', 812);

let page;
let code = 2;
try {
    page = await launch({ width, height });
    await page.open(url);
    if (!(await page.evaluate(APP_READY))) throw new Error(`the app did not start at ${url}`);
    const started = Date.now();
    const out = await page.evaluate(`import('/tests/feature-check.js?t=' + Date.now()).then((m) => m.run()).then((r) => JSON.stringify({ results: r.results, errors: window.__velaErrors || [], version: typeof APP_VERSION === 'string' ? APP_VERSION : '' }))`);
    const { results, errors, version } = JSON.parse(out);
    const bad = results.filter((r) => !r.ok);
    if (process.argv.includes('--list')) results.forEach((r) => console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}`));
    bad.forEach((r) => console.log(`FAIL  ${r.name}\n      ${r.detail}`));
    console.log(`\nVela ${version} at ${width}x${height}: ${results.length - bad.length} of ${results.length} passed in ${Math.round((Date.now() - started) / 1000)} s`);
    if (errors.length || page.pageErrors.length) console.log(`Errors in the page: ${JSON.stringify([...errors, ...page.pageErrors]).slice(0, 1500)}`);
    code = bad.length ? 1 : 0;
} catch (e) {
    console.error(`Could not run the tests: ${e.message}`);
}
if (page) await page.close();
process.exit(code);
