// Copies the Vela web app (repository root) into ./www for the Android app.
// Everything the app needs is bundled locally, so it works fully offline:
// CDN scripts -> www/vendor, Google Fonts -> www/fonts, no service worker.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const root = join(mobile, '..');
const www = join(mobile, 'www');
const nm = join(mobile, 'node_modules');

rmSync(www, { recursive: true, force: true });
mkdirSync(join(www, 'vendor'), { recursive: true });
mkdirSync(join(www, 'fonts'), { recursive: true });

for (const f of ['style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png']) {
    cpSync(join(root, f), join(www, f));
}
// Brand logos (bundled, so the app never fetches them while running).
cpSync(join(root, 'logos'), join(www, 'logos'), { recursive: true });

cpSync(join(nm, 'chart.js/dist/chart.umd.js'), join(www, 'vendor/chart.umd.js'));
cpSync(join(nm, '@supabase/supabase-js/dist/umd/supabase.js'), join(www, 'vendor/supabase.js'));
cpSync(join(nm, 'jspdf/dist/jspdf.umd.min.js'), join(www, 'vendor/jspdf.umd.min.js'));

// Latin subsets of the two families, only the weights the app uses.
const faces = [
    ['Outfit', 'outfit', [500, 600, 700, 800]],
    ['Inter', 'inter', [400, 500, 600, 700]]
];
let fontCss = '';
for (const [family, pkg, weights] of faces) {
    for (const w of weights) {
        const file = `${pkg}-latin-${w}-normal.woff2`;
        cpSync(join(nm, `@fontsource/${pkg}/files/${file}`), join(www, 'fonts', file));
        fontCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:${w};font-display:swap;src:url('${file}') format('woff2');}\n`;
    }
}
writeFileSync(join(www, 'fonts/fonts.css'), fontCss);

let html = readFileSync(join(root, 'index.html'), 'utf8');
const replace = (pattern, value, label) => {
    if (!pattern.test(html)) throw new Error(`build-web: could not find ${label} in index.html`);
    html = html.replace(pattern, value);
};
replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*<link href="https:\/\/fonts\.googleapis\.com[^"]*" rel="stylesheet">/, '<link rel="stylesheet" href="fonts/fonts.css">', 'Google Fonts links');
replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@[^"]+"><\/script>/, '<script src="vendor/chart.umd.js"></script>', 'Chart.js script');
replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"><\/script>/, '<script src="vendor/supabase.js"></script>', 'Supabase script');
replace(/<script>\s*if \('serviceWorker' in navigator\)[\s\S]*?<\/script>/, '', 'service worker registration');
replace(/<html lang="en" data-theme="dark">/, '<html lang="en" data-theme="dark" class="native">', '<html> tag');
writeFileSync(join(www, 'index.html'), html);

const count = (d) => readdirSync(d, { recursive: true }).length;
console.log(`www ready: ${count(www)} files`);
