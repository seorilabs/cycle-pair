interface EndpointEnvironment {
  readonly configured?: string | undefined;
  readonly projectId?: string | undefined;
  readonly region: string;
  readonly emulator: boolean;
  readonly requestHost?: string | undefined;
}

export function accountExportEndpoint(environment: EndpointEnvironment): string {
  if (environment.emulator) {
    if (environment.configured !== undefined || !/^(127\.0\.0\.1|localhost|10\.0\.2\.2):[0-9]{1,5}$/.test(environment.requestHost ?? '') || !environment.projectId || !/^[a-z0-9][a-z0-9-]{3,61}[a-z0-9]$/.test(environment.projectId)) throw new Error('Invalid local export endpoint');
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
