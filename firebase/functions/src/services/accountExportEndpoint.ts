interface EndpointEnvironment {
  readonly configured?: string | undefined;
  readonly projectId?: string | undefined;
  readonly region: string;
  readonly emulator: boolean;
  readonly requestHost?: string | undefined;
  readonly emulatorDeviceHost?: string | undefined;
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function accountExportEndpoint(environment: EndpointEnvironment): string {
  if (environment.emulator) {
    const host = environment.requestHost ?? '';
    const allowedHost = /^(127\.0\.0\.1|localhost|10\.0\.2\.2):[0-9]{1,5}$/.test(host) ||
      (environment.emulatorDeviceHost !== undefined && isPrivateIPv4(environment.emulatorDeviceHost) && host === `${environment.emulatorDeviceHost}:5301`);
    if (environment.configured !== undefined || !allowedHost || !environment.projectId || !/^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/.test(environment.projectId)) throw new Error('Invalid local export endpoint');
    return `http://${environment.requestHost}/${environment.projectId}/${environment.region}/downloadAccountDataExport`;
  }
  if (environment.configured !== undefined) {
    const url = new URL(environment.configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid export download endpoint');
    return url.toString().replace(/\/$/, '');
  }
  if (!environment.projectId || !/^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/.test(environment.projectId)) throw new Error('Invalid Firebase project');
  return `https://${environment.region}-${environment.projectId}.cloudfunctions.net/downloadAccountDataExport`;
}
