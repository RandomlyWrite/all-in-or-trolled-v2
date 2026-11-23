#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { verifyProof } = require('../lib/fairness');
const filepath = process.argv[2];
if (!filepath) {
  console.error('Usage: npm run verify -- hand-proof.json');
  process.exit(2);
}
const proof = JSON.parse(fs.readFileSync(filepath, 'utf8'));
const result = verifyProof(proof);
console.log(result.ok ? 'PASS: ' + result.reason : 'FAIL: ' + result.reason);
process.exit(result.ok ? 0 : 1);
