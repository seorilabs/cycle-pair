import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));
const bannedImport = /^(?:node:|firebase(?:\/|$)|@firebase\/|@react-native-firebase\/|react-native(?:\/|$)|@react-native\/|expo(?:\/|-|$)|@expo\/|@apps-in-toss\/|@granite-js\/|@google-cloud\/|googleapis(?:\/|$)|@apple\/)/;
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']|(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

async function collectTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(path);
      }
      return extname(entry.name) === ".ts" ? [path] : [];
    }),
  );
  return nested.flat();
}

const violations = [];
const files = await collectTypeScriptFiles(sourceRoot);

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (specifier && bannedImport.test(specifier)) {
      violations.push(`${file}: forbidden import '${specifier}'`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Architecture boundary OK (${files.length} source files checked).`);
}
