import process from 'node:process';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {evaluateReleaseReadiness} from './release-readiness-lib.mjs';
const exec = promisify(execFile);
try {
  const {values} = parseArgs({options: {
    target: {type: 'string'}, phase: {type: 'string', default: 'before-release'},
    evidence: {type: 'string'}, authority: {type: 'string'},
  }});
  const result = await evaluateReleaseReadiness(process.cwd(), values);
  const development = {market: 'Development execution', blockers: []};
  if (!values.target) development.blockers.push('--target google-play 또는 app-store 필요');
  if (!values.evidence) development.blockers.push('승인 계획의 실제 실행 근거 --evidence 필요');
  if (!values.authority) development.blockers.push('최신 중앙 checkout --authority 필요');
  if (development.blockers.length === 0) {
    const {stdout: sha} = await exec('git', ['rev-parse', 'HEAD']);
    const {stdout: head} = await exec('git', ['-C', values.authority, 'rev-parse', 'HEAD']);
    const {stdout: remote} = await exec('git', ['-C', values.authority, 'ls-remote', 'origin', 'refs/heads/main']);
    if (head.trim() !== remote.split(/\s/)[0]) throw new Error('중앙 검증기 checkout이 최신 main과 다릅니다.');
    try {
      await exec(process.execPath, [path.resolve(values.authority, 'scripts/release/verify-development-evidence.mjs'), '--file', path.resolve(values.evidence), '--repo', 'seorilabs/cycle-pair', '--sha', sha.trim(), '--target', values.target, '--phase', values.phase], {maxBuffer: 2 ** 20});
    } catch (error) {
      development.blockers.push(String(error.stdout || error.stderr || error.message).trim());
    }
  }
  result.sections.push(development);
  result.ready = result.ready && development.blockers.length === 0;
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
