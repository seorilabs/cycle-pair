export function isLocalDevelopmentHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const parts = host.split('.');
  if (
    parts.length !== 4 ||
    parts.some(
      part => !/^(0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255,
    )
  )
    return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
