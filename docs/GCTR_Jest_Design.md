# Globally Caching Test Runner (GCTR) for Jest

This document outlines a strategy for implementing a **Globally Caching Test Runner (GCTR)** that caches test results across multiple runs for the same repository. The goal is to avoid re-running tests when neither the test files nor their dependencies have changed.

## Overview

GCTR intercepts Jest test execution and stores the resulting JSON output keyed by a content hash of each test file (and optional environment data). On subsequent runs, if the same hash is encountered, the cached results are returned immediately instead of executing the test again.

### Key Components

- **Cache Directory**: `.gctr-cache/` at repository root containing JSON files named after test file hashes.
- **Hash Calculation**: SHA-256 of the test file contents (and optional Node.js version or environment variables) to ensure validity.
- **Runner Script**: Wrapper around Jest that lists test files, checks the cache, runs Jest only for uncached tests, and merges cached results with new results.
- **Integration**: Add `npm run test:gctr` to invoke the runner.

## Pseudocode

```pseudo
for each testFile in jestListTests():
    hash = sha256(testFile contents)
    cachePath = ".gctr-cache/" + hash + ".json"
    if cachePath exists:
        load cached result and append to results
    else:
        run `jest testFile --json --outputFile=temp.json`
        move temp.json to cachePath
        append parsed result to results
summarize and print results
exit with failure code if any test failed
```

### Trade-offs

- **Speed vs. Freshness**: Cached results speed up runs but may hide issues if a test depends on external state or non-deterministic behavior.
- **Storage**: Cached JSON files consume disk space; periodic cleanup may be required.
- **Complexity**: Custom runners require maintenance when upgrading Jest.
- **Existing Solutions**: Jest already has a local cache mechanism, but GCTR extends caching across individual test invocations and can be shared across CI machines if the cache directory is preserved.

## Example Implementation

Below is a simplified Node.js script (`scripts/gctr.js`) demonstrating the concept. It requires Jest to be installed in the project.

```javascript
// scripts/gctr.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(repoRoot, '.gctr-cache');
if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir);

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
for (const testFile of listTests()) {
  const hash = fileHash(testFile);
  const cachePath = path.join(cacheDir, `${hash}.json`);
  if (fs.existsSync(cachePath)) {
    console.log(`Using cache for ${testFile}`);
    results.push(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
    continue;
  }
  console.log(`Running ${testFile}`);
  const result = runTest(testFile, cachePath);
  if (result.numFailedTests > 0) failures += result.numFailedTests;
  results.push(result);
}

console.log(JSON.stringify({ results }, null, 2));
if (failures > 0) process.exit(1);
```

## Setup in a Node Repository

1. **Add the script** to `scripts/gctr.js` as shown above.
2. **Ignore the cache** by adding `.gctr-cache/` to `.gitignore`.
3. **Add an npm script** in `package.json`:
   ```json
   {
     "scripts": {
       "test:gctr": "node scripts/gctr.js"
     }
   }
   ```
4. **Run tests** with caching enabled:
   ```bash
   npm run test:gctr
   ```
   The first run executes all tests and stores results in `.gctr-cache/`. Subsequent runs reuse cached results when files have not changed.

## Conclusion

GCTR can speed up local or CI test runs by avoiding redundant work. It should be used carefully when tests depend on external state or time-sensitive data. Cleaning the cache on major updates or periodically in CI is recommended.

