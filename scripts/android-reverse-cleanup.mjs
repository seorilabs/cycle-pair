// 시험에서 직접 만든 연결만 정리하고 실제 목록으로 결과를 확인한다.
export async function restoreOwnedReversePorts({adb, routes, exec}) {
  const observations = [];
  async function target(deviceId, socket) {
    const {stdout} = await exec(adb, ['-s', deviceId, 'reverse', '--list'], {timeout: 30_000});
    const entries = stdout.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/));
    if (entries.some(entry => entry.length !== 3)) throw Error('Unexpected reverse list');
    const matches = entries.filter(entry => entry[1] === socket);
    if (matches.length > 1) throw Error('Ambiguous reverse route');
    return matches[0]?.[2];
  }
  for (const {deviceId, socket} of routes) {
    let status;
    try {
      const before = await target(deviceId, socket);
      if (before === undefined) status = 'already-absent';
      else if (before !== socket) status = 'changed-target-preserved';
      else {
        // 연결이 먼저 사라지면 remove가 실패할 수 있으므로 최종 목록을 확인한다.
        await exec(adb, ['-s', deviceId, 'reverse', '--remove', socket], {timeout: 30_000}).catch(() => {});
        status = await target(deviceId, socket) === undefined ? 'absence-confirmed' : 'route-remains';
      }
    } catch {
      status = 'inspection-failed';
    }
    observations.push({socket, status});
  }
  return {restored: observations.every(item => ['already-absent', 'absence-confirmed'].includes(item.status)), observations};
}
