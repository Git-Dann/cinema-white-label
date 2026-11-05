'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { contrastRatio, isHex, type ThemeId, type AppearancePolicy } from '@cinema/contracts';
import { api, ApiError, Draft, errorMessage, Film, mediaUrl, Palette, PreviewResult, Release, Settings, tenantPath } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ErrorNote, Loading, PageHeader, SuccessNote } from '@/components/ui';
import { PhonePreview, PreviewFilm } from '@/components/PhonePreview';
import { ContrastReport } from '@/components/ContrastReport';
import { SafeImage } from '@/components/SafeImage';

type BrandingFields = Pick<Draft, 'themeId' | 'paletteId' | 'appearancePolicy' | 'availableThemes' | 'wordmark' | 'logoLightAssetId' | 'logoDarkAssetId' | 'features'>;

const FEATURE_LABELS: Record<keyof Draft['features'], string> = {
  memberships: 'Memberships',
  concessions: 'Food and drink pre-orders',
  wallet: 'Apple Wallet tickets',
  applePay: 'Apple Pay',
  liveActivities: 'Live Activities',
  guestCheckout: 'Guest checkout',
};

const POLICY_LABELS: Record<AppearancePolicy, string> = {
  system: 'Follow device setting',
  alwaysDark: 'Always dark',
  alwaysLight: 'Always light',
};

interface PaletteForm {
  name: string;
  accentLight: string;
  accentDark: string;
  secondaryLight: string;
  secondaryDark: string;
}

const EMPTY_PALETTE: PaletteForm = { name: '', accentLight: '#0F766E', accentDark: '#2DD4BF', secondaryLight: '#9A6700', secondaryDark: '#F5C451' };

function pick(d: Draft): BrandingFields {
  return {
    themeId: d.themeId,
    paletteId: d.paletteId,
    appearancePolicy: d.appearancePolicy,
    availableThemes: d.availableThemes,
    wordmark: d.wordmark,
    logoLightAssetId: d.logoLightAssetId,
    logoDarkAssetId: d.logoDarkAssetId,
    features: d.features,
  };
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export default function BrandingPage() {
  const { tenant, can } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<BrandingFields | null>(null);
  const [form, setForm] = useState<BrandingFields | null>(null);
  const [palettes, setPalettes] = useState<Palette[]>([]);
  const [films, setFilms] = useState<PreviewFilm[]>([]);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [paletteForm, setPaletteForm] = useState<PaletteForm>(EMPTY_PALETTE);
  const [tryPalette, setTryPalette] = useState(false);
  const [paletteMsg, setPaletteMsg] = useState<{ ok?: string; error?: string; issues?: { themeId?: string; appearance?: string; label?: string; ratio?: number; required?: number }[] }>({});
  const [paletteBusy, setPaletteBusy] = useState(false);

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok?: string; error?: string }>({});
  const [uploadBusy, setUploadBusy] = useState<'light' | 'dark' | null>(null);

  const [note, setNote] = useState('');
  const [schedule, setSchedule] = useState('');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishMsg, setPublishMsg] = useState<{ ok?: string; error?: string }>({});

  // ---- Load ----
  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Settings>(tenantPath(tenant, '/settings')), api<Film[]>(tenantPath(tenant, '/films'))])
      .then(([s, f]) => {
        if (cancelled) return;
        setSettings(s);
        setPalettes(s.palettes);
        const b = pick(s.draft);
        setSaved(b);
        setForm(b);
        const withPosters = f.filter((x) => x.poster);
        const ordered = [...withPosters.filter((x) => x.status === 'nowShowing'), ...withPosters.filter((x) => x.status !== 'nowShowing')];
        setFilms(
          ordered.slice(0, 6).map((x) => ({
            id: x.id,
            title: x.title,
            certificate: x.certificate,
            posterUrl: mediaUrl(x.poster!.url, 342),
            focal: x.poster!.focalPoint,
            dominantColor: x.poster!.dominantColor,
          })),
        );
      })
      .catch((e) => !cancelled && setLoadError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tenant]);

  const paletteFormValid =
    paletteForm.name.trim().length > 0 && [paletteForm.accentLight, paletteForm.accentDark, paletteForm.secondaryLight, paletteForm.secondaryDark].every((c) => isHex(c));
  const coloursValid = [paletteForm.accentLight, paletteForm.accentDark, paletteForm.secondaryLight, paletteForm.secondaryDark].every((c) => isHex(c));
  const trialActive = tryPalette && coloursValid;

  // ---- Live preview (debounced; validates without saving) ----
  const previewKey = useMemo(
    () => (form ? JSON.stringify({ form, trial: trialActive ? paletteForm : null }) : null),
    [form, trialActive, paletteForm],
  );
  const seq = useRef(0);
  useEffect(() => {
    if (!form || !previewKey) return;
    const id = ++seq.current;
    setPreviewPending(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      const body: Record<string, unknown> = {
        draft: {
          themeId: form.themeId,
          paletteId: form.paletteId,
          appearancePolicy: form.appearancePolicy,
          availableThemes: form.availableThemes,
          wordmark: form.wordmark.trim() || 'Wordmark',
          logoLightAssetId: form.logoLightAssetId,
          logoDarkAssetId: form.logoDarkAssetId,
        },
      };
      if (trialActive) {
        body.palette = {
          name: paletteForm.name.trim() || 'Unsaved palette',
          accent: { light: paletteForm.accentLight.toUpperCase(), dark: paletteForm.accentDark.toUpperCase() },
          secondary: { light: paletteForm.secondaryLight.toUpperCase(), dark: paletteForm.secondaryDark.toUpperCase() },
        };
      }
      api<PreviewResult>(tenantPath(tenant, '/preview'), { method: 'POST', body, signal: ctrl.signal })
        .then((p) => {
          if (id !== seq.current) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError' || id !== seq.current) return;
          setPreviewError(errorMessage(e));
        })
        .finally(() => id === seq.current && setPreviewPending(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // previewKey captures form + trial palette.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, tenant]);

  const dirty = useMemo(() => !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const update = useCallback(<K extends keyof BrandingFields>(key: K, value: BrandingFields[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaveMsg({});
    setPublishMsg({});
  }, []);

  if (loadError) return <ErrorNote message={loadError} />;
  if (!settings || !form || !saved) return <Loading />;

  const themes = settings.themes;
  const approved = palettes.filter((p) => p.approved);
  const pending = palettes.filter((p) => !p.approved);
  const theme = preview?.theme ?? settings.preview?.theme ?? null;
  const effectivePolicy: AppearancePolicy = theme?.appearancePolicy ?? 'system';
  const report = preview?.report ?? null;
  const reportForPublish = trialActive ? null : report; // a trial palette is not what gets published
  const publishBlockedReason = !can.canPublish
    ? 'Publishing requires an operator admin. Ask an admin to review and publish your draft.'
    : form.wordmark.trim().length === 0
      ? 'Add a wordmark before publishing.'
      : trialActive
        ? 'You are previewing an unsaved palette. Turn off “Preview this palette” to check the configuration that will be published.'
        : previewPending || !reportForPublish
          ? 'Checking the configuration…'
          : !reportForPublish.ok
            ? 'This configuration fails validation. Fix the issues in the contrast report first.'
            : null;

  const appearancesText = effectivePolicy === 'alwaysDark' ? 'dark appearance' : effectivePolicy === 'alwaysLight' ? 'light appearance' : 'light and dark appearances';

  async function saveDraft(): Promise<boolean> {
    if (!form) return false;
    if (!form.wordmark.trim()) {
      setSaveMsg({ error: 'Wordmark cannot be empty.' });
      return false;
    }
    setSaveBusy(true);
    setSaveMsg({});
    try {
      // Send only changed fields so the audit log records what actually changed.
      const full: BrandingFields = { ...form, wordmark: form.wordmark.trim() };
      const patch = Object.fromEntries(
        (Object.keys(full) as (keyof BrandingFields)[])
          .filter((k) => !saved || JSON.stringify(full[k]) !== JSON.stringify(saved[k]))
          .map((k) => [k, full[k]]),
      );
      const next = await api<Draft>(tenantPath(tenant, '/settings'), { method: 'PUT', body: patch });
      const b = pick(next);
      setSaved(b);
      setForm(b);
      setSaveMsg({ ok: 'Draft saved. Customers will not see it until it is published.' });
      return true;
    } catch (e) {
      setSaveMsg({ error: errorMessage(e) });
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    setPublishMsg({});
    let scheduledFor: string | undefined;
    if (schedule) {
      const d = new Date(schedule);
      if (Number.isNaN(d.getTime())) return setPublishMsg({ error: 'Enter a valid date and time.' });
      if (d.getTime() <= Date.now()) return setPublishMsg({ error: 'The scheduled time must be in the future.' });
      scheduledFor = d.toISOString();
    }
    setPublishBusy(true);
    try {
      if (dirty && !(await saveDraft())) return;
      const r = await api<Release>(tenantPath(tenant, '/releases'), { method: 'POST', body: { note: note.trim() || undefined, scheduledFor } });
      setPublishMsg({
        ok: r.status === 'SCHEDULED' ? `Version ${r.version} scheduled for ${new Date(r.scheduledFor!).toLocaleString('en-GB')}.` : `Version ${r.version} is now live in the app.`,
      });
      setNote('');
      setSchedule('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'publish_blocked') {
        const issues = ((err.details as { issues?: { message: string }[] })?.issues ?? []).map((i) => i.message);
        setPublishMsg({ error: `${err.message}${issues.length ? `: ${issues.join('; ')}` : ''}` });
      } else setPublishMsg({ error: errorMessage(err) });
    } finally {
      setPublishBusy(false);
    }
  }

  async function uploadLogo(which: 'light' | 'dark', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return setSaveMsg({ error: 'Logo files must be under 8 MB.' });
    setUploadBusy(which);
    try {
      const dataBase64 = await readFileBase64(file);
      const res = await api<{ id: string; url: string }>(tenantPath(tenant, '/media'), { method: 'POST', body: { kind: 'LOGO', dataBase64 } });
      update(which === 'light' ? 'logoLightAssetId' : 'logoDarkAssetId', res.id);
    } catch (err) {
      setSaveMsg({ error: errorMessage(err) });
    } finally {
      setUploadBusy(null);
    }
  }

  async function createPalette(e: FormEvent) {
    e.preventDefault();
    if (!paletteFormValid) return setPaletteMsg({ error: 'Give the palette a name and four colours in #RRGGBB format.' });
    setPaletteBusy(true);
    setPaletteMsg({});
    try {
      const p = await api<Palette>(tenantPath(tenant, '/palettes'), {
        method: 'POST',
        body: {
          name: paletteForm.name.trim(),
          accent: { light: paletteForm.accentLight.toUpperCase(), dark: paletteForm.accentDark.toUpperCase() },
          secondary: { light: paletteForm.secondaryLight.toUpperCase(), dark: paletteForm.secondaryDark.toUpperCase() },
        },
      });
      setPalettes((ps) => [...ps, p]);
      setPaletteMsg({ ok: `“${p.name}” created. ${can.canApprovePalette ? 'Approve it to make it available.' : 'An operator admin needs to approve it.'}` });
      setPaletteForm(EMPTY_PALETTE);
      setTryPalette(false);
    } catch (err) {
      setPaletteMsg({ error: errorMessage(err) });
    } finally {
      setPaletteBusy(false);
    }
  }

  async function approvePalette(p: Palette) {
    setPaletteMsg({});
    try {
      const res = await api<Palette>(tenantPath(tenant, `/palettes/${p.id}/approve`), { method: 'POST' });
      setPalettes((ps) => ps.map((x) => (x.id === p.id ? res : x)));
      setPaletteMsg({ ok: `“${p.name}” approved. You can now select it.` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'publish_blocked') {
        setPaletteMsg({
          error: `“${p.name}” cannot be approved: it fails contrast checks in the themes this operator offers.`,
          issues: (err.details as { issues?: { themeId?: string; appearance?: string; label?: string; ratio?: number; required?: number }[] })?.issues ?? [],
        });
      } else setPaletteMsg({ error: errorMessage(err) });
    }
  }

  const themeName = (id: string) => themes.find((t) => t.id === id)?.name ?? id;
  const logoLight = mediaUrl(preview?.branding.logoLightUrl ?? (form.logoLightAssetId ? `/v1/media/${form.logoLightAssetId}` : null));
  const logoDark = mediaUrl(preview?.branding.logoDarkUrl ?? (form.logoDarkAssetId ? `/v1/media/${form.logoDarkAssetId}` : null));
  const bgLight = theme?.light.background ?? '#FFFFFF';
  const bgDark = theme?.dark.background ?? '#000000';

  return (
    <>
      <PageHeader
        title="Branding & theme"
        description="Changes are previewed live and validated for accessibility. Customers see them only after you publish."
        actions={
          <>
            {dirty && <span className="badge badge-warning">Unsaved changes</span>}
            <button className="btn" onClick={() => setForm(saved)} disabled={!dirty || saveBusy}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={saveDraft} disabled={!dirty || saveBusy || !can.canEditBranding}>
              {saveBusy ? 'Saving…' : 'Save draft'}
            </button>
          </>
        }
      />
      <ErrorNote message={saveMsg.error} />
      <SuccessNote message={saveMsg.ok} />

      <div className="branding-layout">
        <div className="branding-form">
          {/* Identity */}
          <section className="card" aria-labelledby="identity-title">
            <h2 id="identity-title" className="h3">
              Identity
            </h2>
            <div className="field">
              <label htmlFor="wordmark">Wordmark</label>
              <input
                id="wordmark"
                maxLength={40}
                value={form.wordmark}
                onChange={(e) => update('wordmark', e.target.value)}
                aria-describedby="wordmark-help"
                aria-invalid={form.wordmark.trim() === ''}
              />
              <p id="wordmark-help" className="help">
                Shown when no logo is set and read by VoiceOver. Up to 40 characters.
              </p>
            </div>
            <div className="logo-grid">
              {(['light', 'dark'] as const).map((which) => {
                const url = which === 'light' ? logoLight : logoDark;
                const id = which === 'light' ? form.logoLightAssetId : form.logoDarkAssetId;
                return (
                  <div key={which} className="logo-slot">
                    <div className="label">Logo for {which} backgrounds</div>
                    <div className="logo-box" style={{ background: which === 'light' ? bgLight : bgDark }}>
                      {url ? (
                        <SafeImage src={url} alt={`Current logo for ${which} backgrounds`} fallback={<span className="muted small">Logo unavailable</span>} />
                      ) : (
                        <span className="muted small">No logo</span>
                      )}
                    </div>
                    <div className="row gap-1">
                      <label className={`btn btn-sm file-btn${uploadBusy ? ' disabled' : ''}`}>
                        {uploadBusy === which ? 'Uploading…' : 'Upload PNG or SVG'}
                        <input
                          type="file"
                          accept="image/png,image/svg+xml,image/webp,image/jpeg"
                          className="visually-hidden"
                          onChange={(e) => uploadLogo(which, e)}
                          disabled={!!uploadBusy || !can.canEditBranding}
                          aria-label={`Upload logo for ${which} backgrounds`}
                        />
                      </label>
                      {id && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => update(which === 'light' ? 'logoLightAssetId' : 'logoDarkAssetId', null)}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Theme */}
          <section className="card" aria-labelledby="theme-title">
            <h2 id="theme-title" className="h3">
              Theme
            </h2>
            <fieldset className="field">
              <legend>Default theme</legend>
              <div className="theme-options">
                {themes.map((t) => (
                  <label key={t.id} className={`theme-option${form.themeId === t.id ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="theme"
                      value={t.id}
                      checked={form.themeId === t.id}
                      onChange={() => {
                        update('themeId', t.id);
                        if (!form.availableThemes.includes(t.id)) update('availableThemes', [t.id, ...form.availableThemes]);
                      }}
                    />
                    <span className="theme-name">{t.name}</span>
                    <span className="theme-policy">{POLICY_LABELS[t.appearancePolicy]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="policy">Appearance</label>
              <select
                id="policy"
                value={form.appearancePolicy ?? ''}
                onChange={(e) => update('appearancePolicy', (e.target.value || null) as AppearancePolicy | null)}
                aria-describedby="policy-help"
              >
                <option value="">Theme default ({POLICY_LABELS[themes.find((t) => t.id === form.themeId)?.appearancePolicy ?? 'system']})</option>
                <option value="system">{POLICY_LABELS.system}</option>
                <option value="alwaysDark">{POLICY_LABELS.alwaysDark}</option>
                <option value="alwaysLight">{POLICY_LABELS.alwaysLight}</option>
              </select>
              <p id="policy-help" className="help">
                Only the appearances customers can see are validated.
              </p>
            </div>
            <fieldset className="field">
              <legend>Themes customers can choose</legend>
              <div className="check-grid">
                {themes.map((t) => {
                  const isDefault = t.id === form.themeId;
                  const checked = form.availableThemes.includes(t.id);
                  return (
                    <label key={t.id} className="check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isDefault}
                        onChange={(e) =>
                          update(
                            'availableThemes',
                            e.target.checked ? [...form.availableThemes, t.id as ThemeId] : form.availableThemes.filter((x) => x !== t.id),
                          )
                        }
                      />
                      {t.name}
                      {isDefault && <span className="muted small"> (default)</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>

          {/* Palettes */}
          <section className="card" aria-labelledby="palette-title">
            <h2 id="palette-title" className="h3">
              Brand palette
            </h2>
            <fieldset className="field">
              <legend>Approved palettes</legend>
              {approved.length === 0 && <p className="muted">No approved palettes yet.</p>}
              <div className="palette-options">
                {approved.map((p) => (
                  <label key={p.id} className={`palette-option${form.paletteId === p.id ? ' selected' : ''}`}>
                    <input type="radio" name="palette" value={p.id} checked={form.paletteId === p.id} onChange={() => update('paletteId', p.id)} />
                    <span className="swatches" aria-hidden="true">
                      <span style={{ background: p.accent.light }} />
                      <span style={{ background: p.accent.dark }} />
                      <span style={{ background: p.secondary.light }} />
                      <span style={{ background: p.secondary.dark }} />
                    </span>
                    <span>{p.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {pending.length > 0 && (
              <div className="field">
                <div className="label">Awaiting approval</div>
                <ul className="pending-list">
                  {pending.map((p) => (
                    <li key={p.id}>
                      <span className="swatches" aria-hidden="true">
                        <span style={{ background: p.accent.light }} />
                        <span style={{ background: p.accent.dark }} />
                        <span style={{ background: p.secondary.light }} />
                        <span style={{ background: p.secondary.dark }} />
                      </span>
                      <span className="grow">{p.name}</span>
                      {can.canApprovePalette ? (
                        <button type="button" className="btn btn-sm" onClick={() => approvePalette(p)}>
                          Approve
                        </button>
                      ) : (
                        <span className="muted small">Needs operator admin</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <ErrorNote message={paletteMsg.error} />
            {paletteMsg.issues && paletteMsg.issues.length > 0 && (
              <ul className="issue-list compact">
                {paletteMsg.issues.map((i, idx) => (
                  <li key={idx}>
                    <span className="badge badge-danger">
                      {themeName(i.themeId ?? '')} · {i.appearance}
                    </span>
                    <span className="issue-msg">{i.label}</span>
                    <span className="num">
                      {i.ratio}:1 <span className="muted">/ {i.required}:1</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <SuccessNote message={paletteMsg.ok} />

            <details className="disclosure" open={tryPalette || undefined}>
              <summary>Create a palette</summary>
              <form onSubmit={createPalette} className="palette-form" noValidate>
                <div className="field">
                  <label htmlFor="pal-name">Palette name</label>
                  <input id="pal-name" maxLength={60} value={paletteForm.name} onChange={(e) => setPaletteForm({ ...paletteForm, name: e.target.value })} />
                </div>
                <div className="colour-grid">
                  {(
                    [
                      ['accentLight', 'Accent · light', bgLight],
                      ['accentDark', 'Accent · dark', bgDark],
                      ['secondaryLight', 'Secondary · light', bgLight],
                      ['secondaryDark', 'Secondary · dark', bgDark],
                    ] as [keyof PaletteForm, string, string][]
                  ).map(([key, label, bg]) => {
                    const val = paletteForm[key];
                    const valid = isHex(val);
                    const ratio = valid ? contrastRatio(val, bg) : null;
                    return (
                      <div key={key} className="field colour-field">
                        <label htmlFor={`pal-${key}`}>{label}</label>
                        <div className="colour-input">
                          <input
                            type="color"
                            aria-label={`${label} colour picker`}
                            value={valid ? val.slice(0, 7) : '#000000'}
                            onChange={(e) => setPaletteForm({ ...paletteForm, [key]: e.target.value.toUpperCase() })}
                          />
                          <input
                            id={`pal-${key}`}
                            value={val}
                            maxLength={9}
                            spellCheck={false}
                            aria-invalid={!valid}
                            aria-describedby={`pal-${key}-ratio`}
                            onChange={(e) => setPaletteForm({ ...paletteForm, [key]: e.target.value.trim() })}
                          />
                        </div>
                        <p id={`pal-${key}-ratio`} className={`help ${ratio !== null && ratio < 3 ? 'text-danger' : ''}`}>
                          {valid ? `${ratio!.toFixed(2)}:1 against ${theme?.name ?? 'theme'} background` : 'Use #RRGGBB'}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <label className="check">
                  <input type="checkbox" checked={tryPalette} onChange={(e) => setTryPalette(e.target.checked)} disabled={!coloursValid} />
                  Preview this palette before saving it
                </label>
                <div className="row gap-1 mt-2">
                  <button type="submit" className="btn" disabled={paletteBusy || !paletteFormValid || !can.canEditBranding}>
                    {paletteBusy ? 'Creating…' : 'Create palette'}
                  </button>
                </div>
              </form>
            </details>
          </section>

          {/* Features */}
          <section className="card" aria-labelledby="features-title">
            <h2 id="features-title" className="h3">
              App features
            </h2>
            <div className="check-grid">
              {(Object.keys(FEATURE_LABELS) as (keyof Draft['features'])[]).map((k) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={form.features[k]} onChange={(e) => update('features', { ...form.features, [k]: e.target.checked })} />
                  {FEATURE_LABELS[k]}
                </label>
              ))}
            </div>
          </section>
        </div>

        {/* Preview + publish */}
        <div className="branding-preview">
          <section className="card" aria-labelledby="preview-title">
            <div className="row between">
              <h2 id="preview-title" className="h3">
                Live preview
              </h2>
              <span className="muted small" aria-live="polite">
                {previewPending ? 'Updating…' : theme ? `${theme.name}${trialActive ? ' · unsaved palette' : ''}` : ''}
              </span>
            </div>
            <ErrorNote message={previewError} />
            {theme ? (
              <div className={`phones${previewPending ? ' updating' : ''}`} data-theme-id={theme.themeId} data-accent={theme.dark.actionPrimary}>
                <PhonePreview theme={theme} appearance="light" wordmark={form.wordmark} logoUrl={logoLight} films={films} inactive={effectivePolicy === 'alwaysDark'} />
                <PhonePreview theme={theme} appearance="dark" wordmark={form.wordmark} logoUrl={logoDark} films={films} inactive={effectivePolicy === 'alwaysLight'} />
              </div>
            ) : (
              <Loading label="Building preview…" />
            )}
          </section>

          <section className="card" aria-labelledby="report-title">
            <h2 id="report-title" className="h3">
              Accessibility report
            </h2>
            <ContrastReport report={report} pending={previewPending} appearances={appearancesText} />
          </section>

          <section className="card" aria-labelledby="publish-title">
            <h2 id="publish-title" className="h3">
              Publish
            </h2>
            {can.canPublish ? (
              <form onSubmit={publish}>
                <div className="grid-2 tight">
                  <div className="field">
                    <label htmlFor="release-note">Release note (optional)</label>
                    <input id="release-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Winter campaign colours" />
                  </div>
                  <div className="field">
                    <label htmlFor="release-schedule">Schedule for (optional)</label>
                    <input id="release-schedule" type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} aria-describedby="schedule-help" />
                    <p id="schedule-help" className="help">
                      Leave empty to publish immediately. Local time.
                    </p>
                  </div>
                </div>
                {publishBlockedReason && (
                  <p className="help" id="publish-blocked">
                    {publishBlockedReason}
                  </p>
                )}
                <ErrorNote message={publishMsg.error} />
                {publishMsg.ok && (
                  <p className="alert alert-success" role="status">
                    {publishMsg.ok} <Link href="/releases">View releases</Link>
                  </p>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!!publishBlockedReason || publishBusy}
                  aria-describedby={publishBlockedReason ? 'publish-blocked' : undefined}
                >
                  {publishBusy ? 'Publishing…' : `${dirty ? 'Save and ' : ''}${schedule ? 'schedule' : 'publish'}`.replace(/^./, (c) => c.toUpperCase())}
                </button>
              </form>
            ) : (
              <p className="muted">Publishing requires an operator admin. Save your draft and ask an admin to review and publish it.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
