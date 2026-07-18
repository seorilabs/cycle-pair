import process from "node:process";

import { evaluateReleaseReadiness } from "./release-readiness-lib.mjs";

const result = await evaluateReleaseReadiness(process.cwd());

console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ready ? 0 : 1;
