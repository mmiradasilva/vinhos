import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError, NetworkError } from '../api';

interface Pending {
  email: string;
  display_name: string | null;
  terms_version: string;
  csrf_token: string;
}

/** sign-in US-1 step 3: the "Before you start" screen with the unticked terms checkbox (D1). */
export function WelcomePage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [checkboxError, setCheckboxError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Pending>('/auth/pending-signup', { handle401: false })
      .then(setPending)
      .catch(() => navigate('/signin?error=timeout', { replace: true }));
  }, [navigate]);

  if (!pending) return <p className="page-status">Loading…</p>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!agreed) {
      setCheckboxError('Agree to the terms to continue');
      document.getElementById('accept-terms')?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await api<{ return_to: string }>('/auth/signup', { method: 'POST', body: { accept_terms: true }, csrf: pending.csrf_token, handle401: false });
      window.location.assign(res.return_to);
    } catch (err) {
      setSaving(false);
      if (err instanceof ApiError && err.status === 410) setFormError('Your sign-in timed out. Sign in again.');
      else if (err instanceof ApiError && err.status === 400) setCheckboxError('Agree to the terms to continue');
      else if (err instanceof NetworkError) setFormError("You're offline. Try again when you're connected.");
      else setFormError("Couldn't create your account. Try again.");
    }
  };

  const cancel = async () => {
    await api('/auth/pending-signup', { method: 'DELETE', handle401: false }).catch(() => {});
    navigate('/signin', { replace: true });
  };

  return (
    <section className="narrow">
      <h1>Before you start</h1>
      <p>Signed in as {pending.email}</p>
      <p>
        Read the{' '}
        <Link to="/terms" target="_blank" rel="noopener">
          Terms of use
        </Link>{' '}
        and the{' '}
        <Link to="/privacy" target="_blank" rel="noopener">
          Privacy notice
        </Link>
        .
      </p>
      <form onSubmit={submit} noValidate>
        {formError && (
          <p className="notice notice-error" role="alert">
            {formError} {formError.includes('timed out') && <Link to="/signin">Sign in</Link>}
          </p>
        )}
        <div className={`field checkbox-field${checkboxError ? ' has-error' : ''}`}>
          <input
            id="accept-terms"
            type="checkbox"
            checked={agreed}
            aria-invalid={checkboxError ? true : undefined}
            aria-describedby={checkboxError ? 'accept-terms-error' : undefined}
            onChange={(e) => {
              setAgreed(e.target.checked);
              if (e.target.checked) setCheckboxError(null);
            }}
          />
          <label htmlFor="accept-terms">I agree to the Terms of use and Privacy notice</label>
          {checkboxError && (
            <p id="accept-terms-error" className="field-error" role="alert">
              {checkboxError}
            </p>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Creating account…' : 'Create account'}
          </button>
          <button type="button" className="link-button" onClick={() => void cancel()}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
