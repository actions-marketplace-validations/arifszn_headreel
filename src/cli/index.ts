#!/usr/bin/env node
import { run } from './run.js';

process.exitCode = await run(process.argv.slice(2), {
  log: (line) => console.log(line),
  warn: (line) => console.error(line),
  now: () => new Date(),
});
