import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { removeToolPhotos } from "../lib/photos";
import PageHeader from "../components/PageHeader";

/**
 * The platform admin console.
 *
 * Every read and every action here is an RPC, never a table query. That is not
 * a style choice: `home_lat`, `home_lng` and `phone` are revoked from every
 * database role, and 0060 deliberately did not grant them back. The console
 * sees them by asking a function that checks the flag and writes an events row
 * naming who looked at whom — so the protection stays absolute and each look
 * leaves a trace. Reaching for `.from("profiles")` here would quietly undo
 * both.
 */

const TABS = [
  ["overview", "Overview"],
  ["people", "People"],
  ["reports", "Reports"],
];

function Stat({ label, value, tone = "normal" }) {
  return (
    <div className="rounded-lg border border-cardBorder bg-white p-3">
      <p className="font-mono text-[0.688rem] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-0.5 font-condensed text-2xl font-bold ${
          tone === "alert" && value > 0 ? "text-signal" : "text-asphalt"
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 font-mono text-[0.75rem] uppercase tracking-wide text-asphalt">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function Overview({ onError }) {
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    (async () => {
      const [{ data: s, error: sErr }, { data: a, error: aErr }] = await Promise.all([
        supabase.rpc("admin_overview"),
        supabase.rpc("admin_activity", { p_days: 30 }),
      ]);
      if (sErr) return onError(sErr.message);
      if (aErr) return onError(aErr.message);
      setStats(Array.isArray(s) ? s[0] : s);
      setActivity(a ?? []);
    })();
  }, [onError]);

  // Totals per event type over the window. A sparkline would need a charting
  // dependency; this says the same thing and ships today.
  const totals = {};
  for (const row of activity) totals[row.event_type] = (totals[row.event_type] ?? 0) + Number(row.n);
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const peak = ranked[0]?.[1] ?? 1;

  if (!stats) return <p className="py-8 text-center text-sm text-muted">Loading…</p>;

  return (
    <>
      <Section title="People">
        <Stat label="Accounts" value={stats.accounts} />
        <Stat label="Active" value={stats.accounts_active} />
        <Stat label="Set up" value={stats.accounts_complete} />
        <Stat label="New, 7 days" value={stats.signups_7d} />
        <Stat label="New, 30 days" value={stats.signups_30d} />
        <Stat label="Name hidden" value={stats.accounts_private} />
      </Section>

      <Section title="Tools">
        <Stat label="Listed" value={stats.tools} />
        <Stat label="Paused" value={stats.tools_paused} />
        <Stat label="Out on loan" value={stats.tools_on_loan} />
      </Section>

      <Section title="Borrowing">
        <Stat label="Pending" value={stats.requests_pending} />
        <Stat label="Approved" value={stats.requests_approved} />
        <Stat label="Completed" value={stats.requests_completed} />
        <Stat label="Declined" value={stats.requests_denied} />
      </Section>

      <Section title="Groups and inbox">
        <Stat label="Groups" value={stats.groups_total} />
        <Stat label="Memberships" value={stats.memberships_approved} />
        <Stat label="Open reports" value={stats.reports_open} tone="alert" />
        <Stat label="Feedback" value={stats.feedback_total} />
        <Stat label="Searches, 30d" value={stats.searches_30d} />
      </Section>

      <p className="mb-1.5 font-mono text-[0.75rem] uppercase tracking-wide text-asphalt">
        Activity, last 30 days
      </p>
      {ranked.length === 0 ? (
        <p className="rounded-lg border border-cardBorder bg-white p-3 text-[0.75rem] text-muted">
          Nothing logged yet in this window.
        </p>
      ) : (
        <div className="space-y-1 rounded-lg border border-cardBorder bg-white p-3">
          {ranked.map(([type, n]) => (
            <div key={type} className="flex items-center gap-2">
              <span className="w-44 flex-shrink-0 truncate font-mono text-[0.688rem] text-ink">
                {type.replace(/_/g, " ")}
              </span>
              <span className="h-2 rounded-sm bg-safety" style={{ width: `${Math.max(2, (n / peak) * 60)}%` }} />
              <span className="font-mono text-[0.688rem] text-muted">{n}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function UserDetail({ person, onClose, onError, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  // Typed confirmation rather than a second click. These two actions are not
  // undoable and the hard one takes other people's records with it, so the
  // gesture should cost more than a stray tap.
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("admin_user_detail", { p_profile_id: person.id });
      if (error) return onError(error.message);
      setDetail(Array.isArray(data) ? data[0] : data);
    })();
  }, [person.id, onError]);

  async function run(fn, phrase) {
    if (confirm.trim().toUpperCase() !== phrase) {
      return onError(`Type ${phrase} to confirm.`);
    }
    setBusy(true);
    const { data, error } = await supabase.rpc(fn, {
      p_profile_id: person.id,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) return onError(error.message);
    // Postgres cannot see the Storage bucket, so the photo paths come back
    // here to be cleared. Ignoring the return value orphans every image.
    await removeToolPhotos(data ?? []);
    setConfirm("");
    onChanged();
    onClose();
  }

  const Row = ({ label, value }) => (
    <div className="flex gap-2 py-0.5">
      <span className="w-40 flex-shrink-0 font-mono text-[0.688rem] uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words text-[0.75rem] text-asphalt">{value ?? "—"}</span>
    </div>
  );

  return (
    <div className="mb-3 rounded-lg border border-asphalt bg-white p-3.5">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-condensed text-lg font-bold text-asphalt">{person.display_name ?? "Unnamed"}</p>
        <button type="button" onClick={onClose} className="text-[0.75rem] font-semibold text-racing">
          Close
        </button>
      </div>

      {!detail ? (
        <p className="text-[0.75rem] text-muted">Loading…</p>
      ) : (
        <>
          <Row label="Email" value={detail.email} />
          <Row label="Phone" value={detail.phone} />
          <Row label="Home address" value={detail.default_pickup_location} />
          <Row
            label="Home coordinates"
            value={detail.home_lat != null ? `${detail.home_lat}, ${detail.home_lng}` : null}
          />
          <Row
            label="Public pin"
            value={detail.approx_lat != null ? `${detail.approx_lat}, ${detail.approx_lng}` : null}
          />
          <Row label="Pin radius" value={detail.pin_radius_meters ? `${detail.pin_radius_meters} m` : null} />
          <Row
            label="Address confirmed"
            value={detail.home_address_certified_at ? new Date(detail.home_address_certified_at).toLocaleDateString() : null}
          />
          <Row
            label="Terms accepted"
            value={detail.tos_accepted_at ? `${detail.tos_version ?? "?"} · ${new Date(detail.tos_accepted_at).toLocaleDateString()}` : null}
          />
          <Row label="Joined" value={new Date(detail.created_at).toLocaleDateString()} />
          <Row
            label="Deleted"
            value={detail.deleted_at ? new Date(detail.deleted_at).toLocaleDateString() : null}
          />

          <p className="mt-2 rounded-lg bg-[#FBF4DA] p-2 text-[0.688rem] leading-relaxed text-ink">
            Opening this record wrote an entry naming you and this account. That log is what keeps a
            home address from being something an admin session can read without trace.
          </p>

          <div className="mt-3 border-t border-cardBorder pt-3">
            <label
              htmlFor={`admin-reason-${person.id}`}
              className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
            >
              Reason (optional, recorded)
            </label>
            <input
              id={`admin-reason-${person.id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 text-[0.75rem] text-asphalt"
            />

            <label
              htmlFor={`admin-confirm-${person.id}`}
              className="mb-1 block font-mono text-[0.688rem] uppercase tracking-wide text-asphalt"
            >
              Type the word to confirm
            </label>
            <input
              id={`admin-confirm-${person.id}`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="SCRUB or DELETE"
              className="mb-2 w-full rounded-lg border border-steelLight px-2.5 py-1.5 font-mono text-[0.75rem] text-asphalt"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => run("admin_scrub_account", "SCRUB")}
                className="rounded-lg bg-asphalt px-3 py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-safety disabled:opacity-40"
              >
                Scrub account
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run("admin_hard_delete_account", "DELETE")}
                className="rounded-lg border border-signal px-3 py-2 font-condensed text-[0.75rem] font-bold uppercase tracking-wide text-signal disabled:opacity-40"
              >
                Hard delete
              </button>
            </div>
            <p className="mt-1.5 text-[0.688rem] leading-relaxed text-muted">
              <b>Scrub</b> wipes the name, contact details and location, removes their tools and photos,
              and hands any group they run to its longest-standing member — but keeps the row, so other
              people's borrow history still resolves to someone. <b>Hard delete</b> removes the account
              outright and cascades, which will leave gaps in the records of people who did nothing
              wrong. Prefer scrub unless the record genuinely must go.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function People({ onError }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users", {
      p_query: query.trim() || null,
      p_limit: 50,
      p_offset: 0,
    });
    setLoading(false);
    if (error) return onError(error.message);
    setRows(data ?? []);
  }, [query, onError]);

  useEffect(() => {
    const handle = setTimeout(load, 250);
    return () => clearTimeout(handle);
  }, [load]);

  return (
    <>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search accounts"
        placeholder="Search by name or email"
        className="mb-3 w-full rounded-lg border border-panelBorder bg-panel px-3 py-2 text-sm text-steelLight outline-none placeholder:text-steelLight placeholder:opacity-60"
      />

      {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">Nobody matches that.</p>
      )}

      {rows.map((p) =>
        open === p.id ? (
          <UserDetail
            key={p.id}
            person={p}
            onClose={() => setOpen(null)}
            onError={onError}
            onChanged={load}
          />
        ) : (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(p.id)}
            className="mb-2 block w-full rounded-lg border border-cardBorder bg-white p-3 text-left"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-semibold text-asphalt">
                {p.display_name ?? "Unnamed"}
              </span>
              <span className="flex-shrink-0 font-mono text-[0.688rem] text-muted">
                {new Date(p.created_at).toLocaleDateString()}
              </span>
            </div>
            <p className="truncate font-mono text-[0.688rem] text-ink">{p.email}</p>
            <p className="mt-1 font-mono text-[0.688rem] text-muted">
              {p.tools_count} listed · {p.borrowed_count} borrowed · {p.lent_count} lent
              {p.reports_against > 0 && (
                <span className="font-semibold text-signal"> · {p.reports_against} open report(s)</span>
              )}
              {p.deleted_at && <span className="text-signal"> · deleted</span>}
              {p.is_platform_admin && <span className="text-racing"> · admin</span>}
              {p.identity_private && <span> · name hidden</span>}
              {!p.profile_complete && !p.deleted_at && <span> · setup unfinished</span>}
            </p>
          </button>
        )
      )}
    </>
  );
}

function Reports({ onError }) {
  const [rows, setRows] = useState([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_reports", { p_open_only: openOnly });
    setLoading(false);
    if (error) return onError(error.message);
    setRows(data ?? []);
  }, [openOnly, onError]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(id, resolved) {
    const { error } = await supabase.rpc("admin_resolve_report", { p_report_id: id, p_resolved: resolved });
    if (error) return onError(error.message);
    load();
  }

  return (
    <>
      <label className="mb-3 flex items-center gap-2">
        <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
        <span className="text-sm text-asphalt">Unresolved only</span>
      </label>

      {loading && <p className="py-6 text-center text-sm text-muted">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          {openOnly ? "Nothing outstanding." : "No reports have been filed."}
        </p>
      )}

      {rows.map((r) => (
        <div key={r.id} className="mb-2 rounded-lg border border-cardBorder bg-white p-3">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-asphalt">
              {r.reported_name ?? "Unnamed"} <span className="font-normal text-muted">reported by</span>{" "}
              {r.reporter_name ?? "Unnamed"}
            </span>
            <span className="flex-shrink-0 font-mono text-[0.688rem] text-muted">
              {new Date(r.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="text-[0.75rem] leading-relaxed text-ink">{r.reason}</p>
          {r.tool_name && (
            <p className="mt-1 font-mono text-[0.688rem] text-muted">
              About: <Link className="text-racing" to={`/tool/${r.tool_id}`}>{r.tool_name}</Link>
            </p>
          )}
          <button
            type="button"
            onClick={() => resolve(r.id, !r.resolved_at)}
            className="mt-2 rounded-lg border border-steelLight px-2.5 py-1.5 font-condensed text-[0.688rem] font-bold uppercase tracking-wide text-asphalt"
          >
            {r.resolved_at ? "Reopen" : "Mark resolved"}
          </button>
        </div>
      ))}
    </>
  );
}

export default function Admin() {
  const { profile } = useAuth();
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const onError = useCallback((message) => setError(message), []);

  // Belt as well as braces. The route guard already refuses non-admins, and
  // every RPC refuses again server-side — this only keeps the screen honest if
  // it is ever reached some other way.
  if (!profile?.is_platform_admin) {
    return (
      <div className="pb-6">
        <PageHeader title="Admin" />
        <p className="px-4 py-16 text-center text-sm text-muted">This area is not available to you.</p>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <PageHeader title="Admin" />

      <div className="px-4 py-4">
        <div className="mb-3 flex gap-1.5">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setError("");
                setTab(id);
              }}
              aria-current={tab === id ? "page" : undefined}
              className={`rounded-lg px-3 py-1.5 font-condensed text-[0.75rem] font-bold uppercase tracking-wide ${
                tab === id ? "bg-asphalt text-safety" : "border border-steelLight text-asphalt"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-[#F0C4C4] bg-[#FCEBEB] p-3 text-sm text-signal">{error}</p>
        )}

        {tab === "overview" && <Overview onError={onError} />}
        {tab === "people" && <People onError={onError} />}
        {tab === "reports" && <Reports onError={onError} />}
      </div>
    </div>
  );
}
