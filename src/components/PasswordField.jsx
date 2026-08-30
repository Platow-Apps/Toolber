import { useState } from "react";

function EyeIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="3" y1="21" x2="21" y2="3" />}
    </svg>
  );
}

/**
 * Password input with a show/hide toggle.
 *
 * Typing a password blind on a phone keyboard is where most sign-in failures
 * actually come from, and a wrong password now costs a fresh Turnstile
 * challenge too. The toggle is a button rather than a checkbox so it doesn't
 * take a tab stop between the field and Submit.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = "current-password",
  required = true,
  minLength,
  error = "",
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-mono text-[0.625rem] uppercase tracking-wide text-muted">
        {label}
      </label>
      <div
        className={`flex items-center rounded-lg border bg-white pr-1 ${
          error ? "border-signal" : "border-cardBorder"
        }`}
      >
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          value={value}
          onChange={onChange}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="w-full bg-transparent px-3 py-2.5 text-sm text-asphalt outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // The state, not the control: a screen reader user needs to know
          // whether their password is currently on screen.
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 text-[0.719rem] text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
