import { spawn } from 'node:child_process';

export function spawnMaestroFlow(binary, args, options, controlUrl, spawnProcess = spawn) {
  return spawnProcess(binary, args, {
    ...options,
    env: { ...options.env, MAESTRO_CONTROL_URL: controlUrl },
  });
}
