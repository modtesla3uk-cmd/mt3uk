const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['/node-tools/node_modules', '/opt/node22/lib/node_modules'] }));
const FPS = 30, DUR = 25, FRAMES = FPS * DUR;
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1520, height: 1920 } });
  await page.goto('file://' + path.resolve(__dirname, 'index.html'));
  await page.waitForFunction(() => window.ready);
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate(t => window.draw(t), i / FPS);
    const name = 'f' + String(i).padStart(4, '0') + '.jpg';
    await page.locator('#c').screenshot({ path: path.join(__dirname, 'frames', name), type: 'jpeg', quality: 95 });
  }
  await browser.close();
  console.log('frames', FRAMES);
})().catch(e => { console.error(e); process.exit(1); });
