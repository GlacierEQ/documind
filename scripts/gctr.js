// Globally Caching Test Runner (GCTR) for Jest
// This script caches test results per test file using a content hash.
// Cached results are reused when the file has not changed.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(repoRoot, '.gctr-cache');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir);
}

function listTests() {
  const output = execSync('npx jest --listTests', { encoding: 'utf8' });
  return output.trim().split('\n').filter(Boolean);
}

function fileHash(file) {
  const data = fs.readFileSync(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function runTest(file, cachePath) {
  const tmp = path.join(cacheDir, `${Date.now()}_result.json`);
  execSync(`npx jest "${file}" --runTestsByPath --json --outputFile="${tmp}"`, {
    stdio: 'inherit',
  });
  fs.renameSync(tmp, cachePath);
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

let failures = 0;
const results = [];

listTests().forEach((testFile) => {
  const hash = fileHash(testFile);
  const cachePath = path.join(cacheDir, `${hash}.json`);
  if (fs.existsSync(cachePath)) {
    console.log(`Using cache for ${testFile}`);
    results.push(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
    return;
  }
  console.log(`Running ${testFile}`);
  const result = runTest(testFile, cachePath);
  if (result.numFailedTests > 0) failures += result.numFailedTests;
  results.push(result);
});

console.log(JSON.stringify({ results }, null, 2));
if (failures > 0) {
  process.exit(1);
}
