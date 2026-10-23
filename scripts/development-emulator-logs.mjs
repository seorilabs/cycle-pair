import { createRequire } from 'node:module';
import path from 'node:path';
import { symlink } from 'node:fs/promises';
import { devNull } from 'node:os';

export async function prepareEmulatorCommand({ root, directory, project, importDirectory }) {
  const require = createRequire(path.join(root, 'firebase/package.json'));
  // CLI and Firestore write these independently of stdout filtering.
  // Use only a new owned directory: never replace existing logs or user files.
  for (const name of ['firebase-debug.log', 'firestore-debug.log'])
    await symlink(devNull, path.join(directory, name));
  return {
    command: process.execPath,
    args: [require.resolve('firebase-tools/lib/bin/firebase.js'), '--config', path.join(root, 'firebase.json'),
      'emulators:start', '--only', 'auth,firestore,functions', '--project', project,
      ...(importDirectory ? ['--import', importDirectory] : [])],
    cwd: directory,
  };
}

// Never forward arbitrary SDK output: auth actions may include short credentials.
export function emulatorStatusLine(line) {
  return line.includes('All emulators ready') ? 'All local emulators ready' : null;
}
