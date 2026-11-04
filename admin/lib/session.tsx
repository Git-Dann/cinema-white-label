'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearSession, errorMessage, getToken, Me, onUnauthorised } from './api';
import { permissions } from './format';

const TENANT_KEY = 'cinema.admin.tenant';

interface SessionValue {
  me: Me;
  tenant: string;
  tenantName: string;
  setTenant: (slug: string) => void;
  signOut: () => void;
  can: ReturnType<typeof permissions>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [tenant, setTenantState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(() => {
    clearSession();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    onUnauthorised(() => signOut());
    return () => onUnauthorised(null);
  }, [signOut]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    api<Me>('/v1/admin/me')
      .then((m) => {
        if (cancelled) return;
        setMe(m);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(TENANT_KEY);
        } catch {
          /* ignore */
        }
        const pick = m.tenants.find((t) => t.slug === stored)?.slug ?? m.tenants[0]?.slug ?? null;
        setTenantState(pick);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [router]);

  const setTenant = useCallback((slug: string) => {
    setTenantState(slug);
    try {
      localStorage.setItem(TENANT_KEY, slug);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<SessionValue | null>(() => {
    if (!me || !tenant) return null;
    return {
      me,
      tenant,
      tenantName: me.tenants.find((t) => t.slug === tenant)?.name ?? tenant,
      setTenant,
      signOut,
      can: permissions(me.role),
    };
  }, [me, tenant, setTenant, signOut]);

  if (error) {
    return (
      <div className="centre-screen">
        <div className="card narrow">
          <h1 className="h2">Unable to load your account</h1>
          <p className="alert alert-error" role="alert">{error}</p>
          <button className="btn" onClick={signOut}>Sign in again</button>
        </div>
      </div>
    );
  }
  if (me && !tenant) {
    return (
      <div className="centre-screen">
        <div className="card narrow">
          <h1 className="h2">No operator assigned</h1>
          <p className="muted">Your account is not linked to any cinema operator.</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  if (!value) {
    return (
      <div className="centre-screen" aria-busy="true">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Small hook for loading tenant-scoped data with reload support. */
export function useTenantData<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => setData(d))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(errorMessage(e));
      })
      .finally(() => !ctrl.signal.aborted && setLoading(false));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, nonce, ...deps]);
  return { data, setData, error, loading, reload: () => setNonce((n) => n + 1) };
}
