export interface AccessRecord {
  key_version: string;
  revealed_at: number;
}

// Short-lived signed tokens expire after 15 minutes; KV TTL is 1 hour (keeps the record for re-signing)
export const TOKEN_TTL_MS = 15 * 60 * 1000;
const KV_ACCESS_TTL_S = 3600;

export async function writeAccessRecord(
  kv: KVNamespace,
  submissionId: string,
  keyVersion: string,
): Promise<void> {
  const record: AccessRecord = { key_version: keyVersion, revealed_at: Date.now() };
  await Promise.all([
    kv.put(`access:${submissionId}`, JSON.stringify(record), { expirationTtl: KV_ACCESS_TTL_S }),
    kv.delete(`revoked:${submissionId}`),
  ]);
}

export async function revokeAccessRecord(
  kv: KVNamespace,
  submissionId: string,
): Promise<void> {
  await Promise.all([
    kv.delete(`access:${submissionId}`),
    // Tombstone blocks stale tokens during the KV global propagation window (~60 s)
    kv.put(`revoked:${submissionId}`, '1', { expirationTtl: 300 }),
  ]);
}

export async function getAccessRecord(
  kv: KVNamespace,
  submissionId: string,
): Promise<AccessRecord | null> {
  const raw = await kv.get(`access:${submissionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as AccessRecord;
}

export async function isRevoked(kv: KVNamespace, submissionId: string): Promise<boolean> {
  return (await kv.get(`revoked:${submissionId}`)) !== null;
}
