#!/usr/bin/env node
const path = require('path');
require('ts-node/register');
const { organizeCases } = require('../src/case/forensicOrganizer');

async function main() {
  const [inputDir, outputDir] = process.argv.slice(2);
  if (!inputDir || !outputDir) {
    console.error('Usage: node case-organizer.js <inputDir> <outputDir>');
    process.exit(1);
  }
  try {
    const results = await organizeCases(
      path.resolve(inputDir),
      path.resolve(outputDir)
    );
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
