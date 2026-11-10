'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorMessage, getToken, LoginUser, rememberedEmail, setSession } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (getToken()) router.replace('/');
    const last = rememberedEmail();
    if (last) {
      setEmail(last);
      setRemember(true);
    }
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string; expiresIn: number; user: LoginUser }>('/v1/admin/auth/login', {
        method: 'POST',
        body: { email, password, remember },
        auth: false,
      });
      setSession(res.token, res.user, remember);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="centre-screen">
      <form className="card narrow login" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">
          <span />
        </div>
        <h1 id="login-title" className="h2">Seatfold operator portal</h1>
        <p className="muted">Sign in to manage your cinema app’s branding, releases and content.</p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="check login-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>
            Remember me for 30 days <span className="muted small">on this device</span>
          </span>
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
