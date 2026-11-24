#!/usr/bin/env node
/**
 * Writes wolof-review.csv from src/strings.ts: every string a chief sees,
 * French | Wolof draft | correction, for a Wolof speaker to review in any
 * spreadsheet. A test fails when the file is out of date.
 *
 *   pnpm --filter @kalangu/example-ndiedieng build && pnpm --filter @kalangu/example-ndiedieng wolof:sheet
 */

import { writeFile } from "node:fs/promises";
import { reviewSheet } from "../dist/strings.js";

const out = new URL("../wolof-review.csv", import.meta.url);
await writeFile(out, reviewSheet());
console.log(`Wrote ${out.pathname}`);
