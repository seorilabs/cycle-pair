import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const coreRoot = path.resolve('packages/product-core/src');
const forbidden = [
  'react-native',
  'expo',
  'firebase',
  '@react-native-firebase',
  '@apps-in-toss',
  '@toss',
  '@google',
  '@apple',
  'storekit',
  'play-billing',
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(entry => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(target)
        : /\.(?:ts|tsx|js|jsx)$/.test(entry.name)
          ? [target]
          : [];
    }),
  );
  return nested.flat();
}

const violations = [];

for (const file of await sourceFiles(coreRoot)) {
  const content = await readFile(file, 'utf8');
  const imports = content.matchAll(
    /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g,
  );

  for (const match of imports) {
    const dependency = match[1];
    if (forbidden.some(prefix => dependency === prefix || dependency.startsWith(`${prefix}/`))) {
      violations.push(`${path.relative(process.cwd(), file)} -> ${dependency}`);
    }
  }
}

if (violations.length > 0) {
  console.error('product-core 플랫폼 경계 위반:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('PASS: product-core에 플랫폼 SDK import가 없습니다.');
