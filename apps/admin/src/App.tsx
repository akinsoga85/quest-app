import { Api, ZONES, weekRuleProblems, type AdminDeletion, type AdminWeek, type QueueItem, type SpotCheckItem, type ZoneId } from "@quest/contract";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { TABS, actionsFor, gradeSummary, isKnownImagery, reasonLabel, shortDate, tabFor, weekMonday, type Tab } from "./logic";
import { configured, supabase } from "./supabase";

// The admin site (A11). Every function behind it checks the staff table, so
// this page shows nothing useful to anyone else.
export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [staff, setStaff] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>(tabFor(window.location.hash));

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const onHash = () => setTab(tabFor(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  useEffect(() => {
    if (!session) return setStaff(null);
    void supabase.rpc("admin_deletions").then(({ error }) => setStaff(!error));
  }, [session]);

  if (!configured) {
    return (
      <main className="narrow">
        <h1>Quest admin</h1>
        <p className="text2">Not connected yet: copy .env.example to .env and add the Supabase project's URL and anon key.</p>
      </main>
    );
  }
  if (!ready) return <main aria-busy="true" />;
  if (!session) return <SignIn />;
  if (staff === null) return <main aria-busy="true" />;
  if (!staff) {
    return (
      <main className="narrow">
        <h1>Staff only</h1>
        <p className="text2">{session.user.email ?? "This account"} isn't on the staff list. An admin adds staff in the Supabase dashboard.</p>
        <button className="btn" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </main>
    );
  }

  return (
    <>
      <header className="top">
        <strong>Quest admin</strong>
        <nav aria-label="Sections">
          {TABS.map((t) => (
            <a key={t.tab} href={`#/${t.tab}`} aria-current={tab === t.tab ? "page" : undefined} className={tab === t.tab ? "tab on" : "tab"}>
              {t.label}
            </a>
          ))}
        </nav>
        <span className="muted small">{session.user.email}</span>
        <button className="link" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      <main>
        {tab === "safety" ? <Safety /> : tab === "weeks" ? <Weeks /> : tab === "spot-check" ? <SpotCheck /> : <Deletions />}
      </main>
    </>
  );
}

function SignIn() {
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    if (e) setError("Couldn't start sign-in.");
  };
  return (
    <main className="narrow">
      <h1>Quest admin</h1>
      <p className="text2">For staff. Sign in with your work Google account.</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="btn primary" onClick={() => void go()}>
        Sign in with Google
      </button>
    </main>
  );
}

// Short-lived links to photos (10 minutes), through the staff storage policy.
function usePhotoLinks(paths: string[]) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    if (!paths.length) return;
    void supabase.storage
      .from("makes")
      .createSignedUrls(paths, 600)
      .then(({ data }) => {
        const next: Record<string, string> = {};
        for (const s of data ?? []) if (s.path && s.signedUrl) next[s.path] = s.signedUrl;
        setLinks(next);
      });
  }, [key]);
  return links;
}

function useRpc<T>(load: () => PromiseLike<{ data: unknown; error: { message: string } | null }>, parse: (d: unknown) => T) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    void load().then(({ data: d, error: e }) => {
      if (e) setError(e.message);
      else {
        setError(null);
        setData(parse(d));
      }
    });
  }, []);
  useEffect(reload, [reload]);
  return { data, error, reload, setData };
}

const zoneName = (z: string) => ZONES[z as ZoneId]?.name ?? z;

// ---------------------------------------------------------------------------
// Safety queue

function Safety() {
  const { data, error, reload } = useRpc(() => supabase.rpc("admin_safety_queue"), (d) => Api["admin.safetyQueue"].output.parse(d));
  const links = usePhotoLinks((data ?? []).filter((i) => !isKnownImagery(i)).map((i) => i.storagePath));
  return (
    <section className="stack">
      <h1>Safety queue</h1>
      <p className="text2">
        Flagged photos and coach concerns, oldest first. Nothing here reaches the coach or family until someone decides. Known abuse imagery is
        never shown: report it through the hash-matching vendor (NCMEC in the US, Cybertip.ca in Canada), then mark it reported. A concern about a
        teen's own safety goes to the on-call lead the same day (docs/operations.md).
      </p>
      {error ? <p className="error">{error}</p> : null}
      {data && data.length === 0 ? <p className="card">The queue is empty.</p> : null}
      <div className="grid">
        {(data ?? []).map((item) => (
          <QueueCard key={item.id} item={item} url={links[item.storagePath]} onDone={reload} />
        ))}
      </div>
    </section>
  );
}

function QueueCard({ item, url, onDone }: { item: QueueItem; url?: string; onDone: () => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const known = isKnownImagery(item);

  const resolve = async (resolution: "released" | "kept_blocked" | "reported" | "removed") => {
    if (resolution === "removed" && !window.confirm("Remove this photo for good?")) return;
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("admin_resolve_safety", { p_item: item.id, p_resolution: resolution });
    if (!e && resolution === "removed" && typeof data === "string") {
      const { error: se } = await supabase.storage.from("makes").remove([data]);
      if (se) setError(`Marked removed, but the photo file is still in storage: ${se.message}`);
    }
    setBusy(false);
    if (e) setError(e.message);
    else onDone();
  };

  return (
    <article className="card">
      {known ? (
        <div className="photo hidden">Not shown</div>
      ) : show && url ? (
        <img className="photo" src={url} alt={`Flagged photo for ${item.quest}`} />
      ) : (
        <button className="photo hidden" onClick={() => setShow(true)} disabled={!url}>
          {url ? "Show photo" : "Loading…"}
        </button>
      )}
      <p className="small muted">
        {item.source === "coach" ? "From the coach" : "From the scan"} · {shortDate(item.created)} · {zoneName(item.zone)}: {item.quest}
      </p>
      <ul className="tags">
        {item.reasons.map((r) => (
          <li key={r} className={r.startsWith("hash_match:") ? "tag danger" : "tag"}>
            {reasonLabel(r)}
          </li>
        ))}
      </ul>
      {item.note ? <p className="text2 small">Coach: {item.note}</p> : null}
      {error ? <p className="error small">{error}</p> : null}
      <div className="actions">
        {actionsFor(item).map((a) => (
          <button key={a.resolution} className={a.resolution === "released" ? "btn small primary" : "btn small"} disabled={busy} onClick={() => void resolve(a.resolution)}>
            {a.label}
          </button>
        ))}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Quest weeks

function Weeks() {
  const { data, error, reload } = useRpc(() => supabase.rpc("admin_quest_weeks", { p_status: "draft" }), (d) => Api["admin.weeks"].output.parse(d));
  return (
    <section className="stack">
      <h1>Quest weeks</h1>
      <p className="text2">Drafts from the quest writer. Approving schedules the week Monday to Sunday; rejecting sends it back to be drafted again.</p>
      {error ? <p className="error">{error}</p> : null}
      {data && data.length === 0 ? <p className="card">No drafts waiting.</p> : null}
      {(data ?? []).map((w) => (
        <WeekCard key={w.id} week={w} onDone={reload} />
      ))}
    </section>
  );
}

function WeekCard({ week, onDone }: { week: AdminWeek; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = weekRuleProblems({
    zone: week.zone as ZoneId,
    weekOf: week.weekOf,
    quests: week.quests.map((q) => ({ zone: week.zone as ZoneId, title: q.title, brief: q.brief, minutes: q.minutes, trainsSkill: q.trainsSkill, tips: q.tips })),
  });
  const decide = async (approve: boolean) => {
    const note = approve ? null : window.prompt("What should the writer change?");
    if (!approve && note === null) return;
    setBusy(true);
    const { error: e } = await supabase.rpc("admin_decide_week", { p_week_id: week.id, p_approve: approve, p_note: note ?? undefined });
    setBusy(false);
    if (e) setError(e.message);
    else onDone();
  };
  return (
    <article className="card">
      <h2>
        {zoneName(week.zone)} · week of {shortDate(week.weekOf)}
      </h2>
      <p className={problems.length ? "error small" : "muted small"}>{problems.length ? problems.join(" · ") : `No rule problems · drafted by ${week.model}`}</p>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Quest</th>
            <th>Minutes</th>
            <th>Skill</th>
          </tr>
        </thead>
        <tbody>
          {week.quests.map((q) => (
            <tr key={q.day}>
              <td>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][q.day - 1] ?? q.day}</td>
              <td>
                <strong>{q.title}</strong>
                <br />
                <span className="text2">{q.brief}</span>
                {q.tips.length ? <span className="muted small"> Tips: {q.tips.join(" · ")}</span> : null}
              </td>
              <td>{q.minutes}</td>
              <td className="small">{q.trainsSkill.split(".")[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="error small">{error}</p> : null}
      <div className="actions">
        <button className="btn small primary" disabled={busy || problems.length > 0} onClick={() => void decide(true)}>
          Approve week
        </button>
        <button className="btn small" disabled={busy} onClick={() => void decide(false)}>
          Send back
        </button>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Coach spot check

function SpotCheck() {
  const [week, setWeek] = useState(weekMonday(new Date(Date.now() - 7 * 86400000)));
  const [items, setItems] = useState<SpotCheckItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void supabase.rpc("admin_spot_check", { p_week_of: week }).then(({ data, error: e }) => {
      if (e) setError(e.message);
      else {
        setError(null);
        setItems(Api["admin.spotCheck"].output.parse(data));
      }
    });
  }, [week]);
  useEffect(load, [load]);
  const links = usePhotoLinks((items ?? []).map((i) => i.storagePath));
  const s = gradeSummary(items ?? []);
  return (
    <section className="stack">
      <h1>Coach spot check</h1>
      <p className="text2">
        A fixed 1% sample of the week's reviews (at least 5). Score each 1–5 the way a mentor would, and tick a guardrail break for anything about
        looks, bodies, comparisons, or that isn't about the photo. Any break is a must-fix.
      </p>
      <label className="row">
        Week of
        <input type="date" value={week} onChange={(e) => e.target.value && setWeek(weekMonday(new Date(`${e.target.value}T12:00:00Z`)))} />
      </label>
      {error ? <p className="error">{error}</p> : null}
      {items ? (
        <div className="card">
          <p>
            {s.graded} of {s.total} graded
            {s.graded ? ` · specific ${s.specific} · accurate ${s.accurate} · kind ${s.kind} · actionable ${s.actionable} · ` : ""}
            {s.graded ? <span className={s.breaks ? "error" : ""}>{s.breaks === 1 ? "1 guardrail break" : `${s.breaks} guardrail breaks`}</span> : null}
          </p>
        </div>
      ) : null}
      <div className="grid">
        {(items ?? []).map((i) => (
          <GradeCard key={i.reviewId} item={i} url={links[i.storagePath]} onSaved={load} />
        ))}
      </div>
    </section>
  );
}

const SCORES = ["specific", "accurate", "kind", "actionable"] as const;

function GradeCard({ item, url, onSaved }: { item: SpotCheckItem; url?: string; onSaved: () => void }) {
  const g = item.grade;
  const [scores, setScores] = useState<Record<(typeof SCORES)[number], number>>({
    specific: g?.specific ?? 0,
    accurate: g?.accurate ?? 0,
    kind: g?.kind ?? 0,
    actionable: g?.actionable ?? 0,
  });
  const [broke, setBroke] = useState(g?.guardrail_break ?? false);
  const [note, setNote] = useState(typeof g?.note === "string" ? g.note : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = SCORES.every((k) => scores[k] >= 1);

  const save = async () => {
    setBusy(true);
    const { error: e } = await supabase.rpc("admin_grade_review", {
      p_review: item.reviewId,
      p_specific: scores.specific,
      p_accurate: scores.accurate,
      p_kind: scores.kind,
      p_actionable: scores.actionable,
      p_guardrail_break: broke,
      p_note: note,
    });
    setBusy(false);
    if (e) setError(e.message);
    else onSaved();
  };

  return (
    <article className="card">
      {url ? <img className="photo" src={url} alt={`The photo for ${item.quest}`} /> : <div className="photo hidden">Loading…</div>}
      <p className="small muted">
        {zoneName(item.zone)}: {item.quest} · confidence {Math.round(item.confidence * 100)}%
        {item.helpful === null ? "" : item.helpful ? " · teen: helpful" : " · teen: not helpful"}
      </p>
      <dl>
        <dt>What worked</dt>
        <dd>{item.worked}</dd>
        <dt>Try next</dt>
        <dd>{item.tryNext}</dd>
        <dt>Why</dt>
        <dd>{item.why}</dd>
        {item.question ? (
          <>
            <dt>Question</dt>
            <dd>{item.question}</dd>
          </>
        ) : null}
      </dl>
      {SCORES.map((k) => {
        const label = k[0]!.toUpperCase() + k.slice(1);
        return (
          <div key={k} className="scores" role="radiogroup" aria-label={label}>
            <span className="text2">{label}</span>
            <div className="pills">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className={scores[k] === n ? "pill on" : "pill"}>
                  <input type="radio" name={`${item.reviewId}-${k}`} value={n} checked={scores[k] === n} onChange={() => setScores({ ...scores, [k]: n })} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <label className="check">
        <input type="checkbox" checked={broke} onChange={(e) => setBroke(e.target.checked)} />
        Guardrail break
      </label>
      <textarea value={note} maxLength={500} placeholder="Note for the coach prompt (optional)" onChange={(e) => setNote(e.target.value)} />
      {error ? <p className="error small">{error}</p> : null}
      <button className="btn small primary" disabled={!ready || busy} onClick={() => void save()}>
        {g ? "Update grade" : "Save grade"}
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Deletions

function Deletions() {
  const { data, error } = useRpc(() => supabase.rpc("admin_deletions"), (d) => Api["admin.deletions"].output.parse(d));
  return (
    <section className="stack">
      <h1>Deletions</h1>
      <p className="text2">
        Accounts asking to be deleted. The daily job deletes each one 7 days after the request, always within 30 days. One that's held keeps its
        evidence for a safety report; resolve the report in the safety queue and the job picks it up.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Requested</th>
            <th>Must finish by</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((d: AdminDeletion) => (
            <tr key={d.id}>
              <td>{shortDate(d.requested)}</td>
              <td>{shortDate(d.completesBy)}</td>
              <td className={d.held ? "error" : ""}>{d.completed ? `Done ${shortDate(d.completed)}` : (d.held ?? "Waiting")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.length === 0 ? <p className="muted">No deletions in the last 30 days.</p> : null}
    </section>
  );
}
