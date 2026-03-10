const { execSync } = require('child_process');
try {
  const result = execSync('npx eslint src --ext .ts,.tsx --format compact', { encoding: 'utf8' });
  console.log('No lint errors found.');
} catch (error) {
  const output = error.stdout || error.message;
  const lines = output.split('\n').filter(l => l.includes('Error - '));
  console.log('Errors found: ' + lines.length);
  if (lines.length > 0) {
    if (lines.length > 30) {
      console.log(lines.slice(0, 30).join('\n'));
      console.log('... (truncated ' + (lines.length - 30) + ' errors)');
    } else {
      console.log(lines.join('\n'));
    }
  } else {
    console.log('No critical errors, only warnings.');
  }
}
