// Screenshot-Pass im iPad-Viewport nach größeren UI-Meilensteinen.
// Kein WebKit in dieser Umgebung verfügbar — dient der visuellen Kontrolle
// unter Chromium, ersetzt keine echte iPad-Safari-Prüfung (siehe README).
import { chromium, devices } from './pw.mjs';
import { startServer } from './serve.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(__dirname, 'fixtures');
const outDir = path.resolve(__dirname, 'screenshots');
mkdirSync(outDir, { recursive: true });

const { server, url } = await startServer();
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...devices['iPad (gen 7)'] });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err));

  await page.goto(url);
  await page.screenshot({ path: path.join(outDir, '01-import-screen.png') });

  await page.setInputFiles('#file-lv', path.join(fixtures, 'LV_Goettingen.X86'));
  await page.setInputFiles('#file-x31', path.join(fixtures, 'Aufmass_Goettingen.X31'));
  await page.click('#btn-import');
  await page.waitForSelector('#screen-list:not([hidden])');
  await page.screenshot({ path: path.join(outDir, '02-list-screen.png') });

  await page.click('#btn-filter');
  await page.screenshot({ path: path.join(outDir, '03-filter-panel.png') });
  await page.click('#btn-filter');

  const row = page.locator('.row-item[data-id="id74"]');
  await row.locator('.toggle-details').click();
  await row.locator('.toggle-bemerkung').click();
  await row.locator('.inp-bemerkung').fill('Vor Ort geprüft, i.O.');
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, '04-row-expanded.png') });

  await row.locator('.chk-geprueft').check();
  await page.click('#btn-export');
  await page.waitForSelector('#export-warning-dialog[open]');
  await page.screenshot({ path: path.join(outDir, '05-export-warning.png') });
  await page.click('#export-warning-proceed');
  await page.waitForSelector('#toast:not([hidden])');
  await page.screenshot({ path: path.join(outDir, '06-export-toast.png') });

  console.log('Screenshots gespeichert in', outDir);
} finally {
  await browser.close();
  server.close();
}
