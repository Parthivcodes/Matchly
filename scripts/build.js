const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const output = path.join(root, 'public');
fs.mkdirSync(output, { recursive: true });
for (const file of ['index.html', 'dashboard.html', 'login.html']) {
  fs.copyFileSync(path.join(root, 'frontend', file), path.join(output, file));
}
for (const directory of ['css', 'js']) {
  fs.cpSync(path.join(root, 'frontend', directory), path.join(output, 'static', directory), { recursive: true });
}
console.log('Vercel static assets prepared.');
