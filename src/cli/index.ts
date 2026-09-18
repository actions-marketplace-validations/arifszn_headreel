#!/usr/bin/env node
import { parseArgs } from 'node:util';

const USAGE = `Usage: headreel --style <style> --user <login> [options]

Not implemented yet.`;

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
  },
  strict: false,
});

if (values.help) {
  console.log(USAGE);
} else {
  console.error(USAGE);
  process.exitCode = 1;
}
