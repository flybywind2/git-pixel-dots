export interface CertificateMeta {
  basicAt: string | null;
  allAt: string | null;
  name: string;
}

const KEY = 'gitdots.certificate.v1';

function storage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function readCertificateMeta(): CertificateMeta {
  const fallback: CertificateMeta = { basicAt: null, allAt: null, name: '' };
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return fallback;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return fallback;
    const record = value as Record<string, unknown>;
    return {
      basicAt: typeof record.basicAt === 'string' ? record.basicAt : null,
      allAt: typeof record.allAt === 'string' ? record.allAt : null,
      name: typeof record.name === 'string' ? record.name : '',
    };
  } catch {
    return fallback;
  }
}

export function writeCertificateMeta(patch: Partial<CertificateMeta>): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ ...readCertificateMeta(), ...patch }));
  } catch {
    // 수료증 부가 정보는 저장이 안 돼도 실습 진행에는 영향이 없어요.
  }
}
