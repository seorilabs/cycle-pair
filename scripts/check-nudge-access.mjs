// No credentials or user data. The callable must reject this at its Auth guard,
// rather than Cloud Run rejecting it before Firebase can inspect the request.
const base = 'https://asia-northeast3-seorilabs-cyclepair-prod.cloudfunctions.net';
for (const name of ['sendPartnerNudge', 'acknowledgePartnerNudge']) {
  const response = await fetch(`${base}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: {} }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 401 || body?.error?.status !== 'UNAUTHENTICATED') {
    throw new Error(`${name}: expected Firebase UNAUTHENTICATED, got HTTP ${response.status}`);
  }
  console.log(`${name}: Firebase Auth guard reached, unauthenticated request rejected`);
}
