const fs = require('fs');
const path = require('path');

const htmlPaths = [
  path.join(__dirname, 'public', 'ui-preview', 'landing.html'),
  path.join(__dirname, 'public', 'index.html'),
];

const makeChecks = (html) => [
  {
    name: 'hero image fills PC canvas',
    pass: /\.hero-art\s+img\s*\{[^}]*object-fit:\s*cover/i.test(html),
  },
  {
    name: 'origin image fills two-column panel',
    pass: /\.origin-image\s+img\s*\{[^}]*object-fit:\s*cover/i.test(html),
  },
  {
    name: 'hero uses old-project PC canvas',
    pass: /\.hero-art\s*\{[^}]*position:\s*absolute/i.test(html) && /\.hero-copy\s*\{[^}]*width:\s*min\(52%,\s*620px\)/i.test(html),
  },
  {
    name: 'music player is integrated into landing page',
    pass: /<div class="player" id="player">/.test(html) && /<audio id="bgm"/.test(html),
  },
];

let failed = [];

for (const htmlPath of htmlPaths) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const label = path.relative(__dirname, htmlPath);
  const checks = makeChecks(html);
  failed = failed.concat(checks.filter((check) => !check.pass).map((check) => ({ ...check, label })));

  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${label}: ${check.name}`);
  }
}

if (failed.length) {
  process.exitCode = 1;
}
