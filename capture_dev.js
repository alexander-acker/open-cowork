const { spawn } = require('child_process');
const fs = require('fs');
const out = fs.createWriteStream('dev_plain.txt');
const child = spawn('npm', ['run', 'dev'], { stdio: 'pipe', shell: true });
child.stdout.pipe(out);
child.stderr.pipe(out);
child.on('exit', (code) => {
  out.write('\nEXIT CODE: ' + code);
  out.end();
  console.log('DONE');
});
// Kill after 15 seconds if it gets stuck
setTimeout(() => {
  child.kill();
}, 15000);
