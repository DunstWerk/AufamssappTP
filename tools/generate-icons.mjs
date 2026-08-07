// Einmaliges Hilfsskript: generiert die PWA-Icons per Chromium-Screenshot
// (kein ImageMagick/PIL in dieser Umgebung verfügbar). Nicht Teil der
// App-Auslieferung selbst, nur zur Erzeugung der PNGs unter icons/.
import { chromium } from '../test/pw.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.resolve(__dirname, '../icons');

const html = `
<html><head><style>
  html,body{margin:0;padding:0;}
  .icon{
    width:100vw;height:100vh;
    background:linear-gradient(160deg,#1c6dd0,#123f7d);
    display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,Arial,sans-serif;
  }
  .check{
    width:58%;height:58%;
    border-radius:18%;
    background:rgba(255,255,255,0.12);
    display:flex;align-items:center;justify-content:center;
  }
  svg{ width:70%; height:70%; }
</style></head>
<body>
  <div class="icon"><div class="check">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 13l4 4L19 7" stroke="#ffffff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);

for (const size of [192, 512, 180]) {
  await page.setViewportSize({ width: size, height: size });
  const filename = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await page.screenshot({ path: path.join(iconsDir, filename) });
  console.log('Generated', filename);
}

await browser.close();
