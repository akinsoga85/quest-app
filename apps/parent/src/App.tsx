import { Api, DELETION_DAYS, PHOTO_LINK_SECONDS, PLUS, exportFileName, photoPaths, withPhotoLinks, type DeletionRequest, type InvitePreview, type ParentFeedItem, type ParentOverview, type ParentPlus } from "@quest/contract";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { CHEERS, bestZone, plusLine, questsLine, route, shortDay, signInRedirect } from "./logic";
import { configured, supabase } from "./supabase";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const r = route(window.location.pathname, window.location.search);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return (
      <main>
        <h1>Parent page</h1>
        <p className="text2">Not connected yet: copy .env.example to .env and add the Supabase project's URL and anon key.</p>
      </main>
    );
  }
  if (!ready) return <main aria-busy="true" />;
  if (r.page === "delete") return <DeleteAccount session={session} />;
  return r.page === "consent" ? <Consent token={r.token} session={session} /> : <Home session={session} />;
}

// ---------------------------------------------------------------------------
// H24: consent

function Consent({ token, session }: { token: string; session: Session | null }) {
  const [preview, setPreview] = useState<InvitePreview | undefined>(undefined);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void supabase.rpc("invite_preview", { p_token: token }).then(({ data }) => setPreview(Api["parent.preview"].output.safeParse(data).data ?? null));
  }, [token]);

  const consent = async () => {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("give_parent_consent", { p_token: token, p_is_adult: true });
    setBusy(false);
    if (rpcError) setError(/teen accounts/.test(rpcError.message) ? "This is a teen account. Sign in with your own account." : "That didn't work. The link may have expired: ask your teen for a new one.");
    else setDone((data as { teenHandle: string }).teenHandle);
  };

  if (preview === undefined) return <main aria-busy="true" />;
  if (done) {
    return (
      <main>
        <p className="eyebrow">For parents and guardians</p>
        <h1>You're linked with {done}</h1>
        <p className="text2">Thank you. They can now get coach reviews and send you their work. You'll find it on your parent page.</p>
        <a className="btn primary" href="/">
          Go to your parent page
        </a>
      </main>
    );
  }
  if (preview === null) {
    return (
      <main>
        <p className="eyebrow">For parents and guardians</p>
        <h1>This link has expired</h1>
        <p className="text2">Links work for 7 days. Ask your teen to send a new one from the app.</p>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">For parents and guardians</p>
      <h1>{preview.teenHandle} wants to join</h1>
      <p className="text2">A daily creative practice app for teens 13–19. Here is exactly what it does.</p>
      <section className="card" aria-labelledby="can">
        <h2 id="can">What your teen can do</h2>
        <ul className="list">
          <li><span className="tick" aria-hidden>✓</span>Do one short creative quest a day</li>
          <li><span className="tick" aria-hidden>✓</span>Get AI coaching on technique, never on looks</li>
          <li><span className="tick" aria-hidden>✓</span>Keep a private portfolio, and send pieces to you if they choose</li>
        </ul>
      </section>
      <section className="card" aria-labelledby="cannot">
        <h2 id="cannot">What nobody can do</h2>
        <ul className="list">
          <li><span className="no" aria-hidden>⊘</span>Message your teen or comment on their work</li>
          <li><span className="no" aria-hidden>⊘</span>See their real name, school or location</li>
          <li><span className="no" aria-hidden>⊘</span>See their work, unless they send it to you</li>
        </ul>
      </section>
      <section className="card" aria-labelledby="asked">
        <h2 id="asked">You'll be asked to</h2>
        <ul className="list">
          <li><span className="num">1</span>Sign in, so you can manage consent later</li>
          <li><span className="num">2</span>Confirm you're their parent or guardian, and an adult</li>
        </ul>
      </section>
      {session ? (
        <>
          <p className="muted small">Signed in as {session.user.email ?? "you"}.</p>
          <label className="check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            I'm their parent or guardian, I'm 18 or older, and I agree
          </label>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="btn primary" disabled={!agree || busy} onClick={() => void consent()}>
            Give consent
          </button>
        </>
      ) : (
        <SignIn title="Sign in to give consent" />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sign in: Apple, Google, or an emailed link

function SignIn({ title }: { title: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = signInRedirect(window.location.origin, window.location.pathname, window.location.search);

  const oauth = async (provider: "apple" | "google") => {
    const { error: e } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (e) setError("Couldn't start sign-in. Try again.");
  };
  const magic = async () => {
    const { error: e } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    if (e) setError("Couldn't send the link. Check the address and try again.");
    else setSent(true);
  };

  return (
    <section className="card" aria-labelledby="signin">
      <h2 id="signin">{title}</h2>
      <button className="btn white" onClick={() => void oauth("apple")}>
        <AppleLogo /> Continue with Apple
      </button>
      <button className="btn" onClick={() => void oauth("google")}>
        <GoogleLogo /> Continue with Google
      </button>
      {sent ? (
        <p className="text2" role="status">Check your email for a sign-in link.</p>
      ) : (
        <>
          <label className="small muted" htmlFor="email">Or get a sign-in link by email</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" disabled={!/^\S+@\S+\.\S+$/.test(email)} onClick={() => void magic()}>
            Email me a sign-in link
          </button>
        </>
      )}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <p className="muted small">Apple and Google share only your name and email with us.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// H25: the parent page

function Home({ session }: { session: Session | null }) {
  const [overview, setOverview] = useState<ParentOverview | null>(null);
  const [plus, setPlus] = useState<ParentPlus>([]);
  const [paying, setPaying] = useState(false);
  const [feed, setFeed] = useState<ParentFeedItem[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, f, pl] = await Promise.all([supabase.rpc("parent_overview"), supabase.rpc("parent_feed", { p_limit: 20 }), supabase.rpc("parent_plus")]);
    setPlus(Api["parent.plus"].output.safeParse(pl.data).data ?? []);
    const po = Api["parent.overview"].output.safeParse(o.data);
    const pf = Api["parent.feed"].output.safeParse(f.data);
    if (o.error || f.error || !po.success || !pf.success) {
      setError("Couldn't load your page. Try again.");
      return;
    }
    setOverview(po.data);
    setFeed(pf.data);
    if (pf.data.length) {
      const { data } = await supabase.storage.from("makes").createSignedUrls(pf.data.map((i) => i.storagePath), 600);
      const links: Record<string, string> = {};
      for (const d of data ?? []) if (d.path && d.signedUrl) links[d.path] = d.signedUrl;
      setUrls(links);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  if (!session) {
    return (
      <main>
        <p className="eyebrow">Parent page</p>
        <h1>Welcome back</h1>
        <SignIn title="Sign in to see what your teen sent you" />
      </main>
    );
  }

  // Plus is bought here, by a parent, for each linked teen (Stripe).
  const startPlus = async (teenId: string, path: "checkout" | "portal") => {
    setPaying(true);
    setError(null);
    const { data, error: e } = await supabase.functions.invoke(`payments/${path}`, { body: path === "checkout" ? { teenId } : {} });
    const url = (data as { url?: string } | null)?.url;
    if (e || !url) {
      setError("Couldn't open the payment page. Try again later.");
      setPaying(false);
      return;
    }
    window.location.assign(url);
  };

  // A 16–17 asked to buy Plus in the app: a yes lets them, for 7 days.
  const decidePlus = async (requestId: string, approve: boolean) => {
    const { error: e } = await supabase.rpc("decide_plus_request", { p_request_id: requestId, p_approve: approve });
    if (e) setError("Couldn't save your answer. Try again.");
    await load();
  };

  const cheer = async (shareId: string, value: string) => {
    const { error: e } = await supabase.rpc("cheer_share", { p_share_id: shareId, p_cheer: value as ParentFeedItem["cheer"] & string });
    if (e) setError("Couldn't send that cheer.");
    await load();
  };

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted small">Signed in as {session.user.email ?? "you"}</span>
        <button className="link" onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </div>
      <p className="eyebrow">Parent page</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {overview && overview.teens.length === 0 ? (
        <p className="text2">No teen is linked to this account yet. Open the link your teen sent you to give consent.</p>
      ) : null}

      {overview?.teens.map((t) => {
        const best = bestZone(t);
        return (
          <section key={t.teenId} style={{ display: "contents" }}>
            <h1>{t.handle} this week</h1>
            <div className="grid2">
              <div className="card">
                <span className="stat">{t.questsThisWeek}</span>
                <span className="muted small">{questsLine(t.questsThisWeek)}</span>
              </div>
              {best ? (
                <div className="card">
                  <span className="stat">{best.level}</span>
                  <span className="muted small">{best.where}</span>
                </div>
              ) : null}
            </div>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2>AI coach reviews</h2>
                  <p className="muted small">{t.coachOn ? "On. Feedback on technique, never on looks." : "Off."}</p>
                </div>
                {t.coachOn ? (
                  <button className="pill" onClick={() => void supabase.rpc("set_ai_coach_consent", { p_allow: false, p_teen_id: t.teenId }).then(load)}>
                    Turn off
                  </button>
                ) : null}
              </div>
              {!t.coachOn ? <p className="muted small">Only your teen can turn it back on, from the app.</p> : null}
            </div>
            <PlusCard
              handle={t.handle}
              status={plus.find((p) => p.teenId === t.teenId) ?? null}
              busy={paying}
              onStart={() => void startPlus(t.teenId, "checkout")}
              onManage={() => void startPlus(t.teenId, "portal")}
              onDecide={(requestId, approve) => void decidePlus(requestId, approve)}
            />
          </section>
        );
      })}

      <section className="card" aria-labelledby="sent">
        <h2 id="sent">Sent to you</h2>
        {feed.length === 0 ? <p className="muted small">Nothing yet. Your teen chooses what to send; you'll see it here.</p> : null}
        {feed.map((item) => (
          <article key={item.shareId} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {urls[item.storagePath] ? <img className="photo" src={urls[item.storagePath]} alt={`${item.teenHandle}'s make for "${item.questTitle}"`} /> : <div className="photo" />}
            <p className="small text2">
              {item.teenHandle} · {item.questTitle} · {shortDay(item.day)}
            </p>
            {item.cheer ? (
              <p className="small">You sent: <strong>{CHEERS.find((c) => c.value === item.cheer)?.label}</strong></p>
            ) : (
              <div className="row" style={{ flexWrap: "wrap" }} role="group" aria-label="Send a cheer back">
                {CHEERS.map((c) => (
                  <button key={c.value} className="pill" onClick={() => void cheer(item.shareId, c.value)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {overview ? (
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <h2>Weekly email</h2>
              <p className="muted small">Quests, levels and zones. No photos unless they send one.</p>
            </div>
            <input
              className="switch"
              type="checkbox"
              role="switch"
              aria-label="Weekly email"
              checked={overview.weeklyEmail}
              onChange={(e) => void supabase.rpc("set_weekly_email", { p_on: e.target.checked }).then(load)}
            />
          </div>
        </section>
      ) : null}
      <p className="muted small">We never sell data or show ads. There are no messages and no comments, only cheers.</p>
      <a className="link small" href="/delete">
        Download your data or delete your account
      </a>
    </main>
  );
}

// ---------------------------------------------------------------------------
// /delete: download your data, or delete your account (A11). For parents, and
// for teens on the web: Google Play lists this page as the deletion link.

function DeleteAccount({ session }: { session: Session | null }) {
  const [pending, setPending] = useState<DeletionRequest | null | undefined>(undefined);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session) void supabase.rpc("my_deletion").then(({ data }) => setPending(Api["account.deletion"].output.safeParse(data).data ?? null));
  }, [session]);

  const download = async () => {
    setError(null);
    const { data, error: e } = await supabase.rpc("export_my_data");
    const parsed = Api["account.export"].output.safeParse(data);
    if (e || !parsed.success) {
      setError(e && /nothing to export/.test(e.message) ? "There's nothing saved for this account." : "Couldn't gather your data. Try again.");
      return;
    }
    const links: Record<string, string> = {};
    const paths = photoPaths(parsed.data);
    for (let i = 0; i < paths.length; i += 100) {
      const { data: signed } = await supabase.storage.from("makes").createSignedUrls(paths.slice(i, i + 100), PHOTO_LINK_SECONDS);
      for (const s of signed ?? []) if (s.path && s.signedUrl) links[s.path] = s.signedUrl;
    }
    const profile = parsed.data.profile as { handle?: string; name?: string } | undefined;
    const blob = new Blob([JSON.stringify(withPhotoLinks(parsed.data, links), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName(profile?.handle ?? "parent", parsed.data.exportedAt);
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const request = async () => {
    setBusy(true);
    setError(null);
    const { data, error: e } = await supabase.rpc("request_account_deletion");
    setBusy(false);
    const parsed = Api["account.delete"].output.safeParse(data);
    if (e || !parsed.success) setError("Couldn't start the deletion. Try again.");
    else setPending(parsed.data);
  };

  const keep = async () => {
    setBusy(true);
    const { error: e } = await supabase.rpc("cancel_account_deletion");
    setBusy(false);
    if (e) setError("Couldn't cancel. Try again.");
    else setPending(null);
  };

  return (
    <main>
      <p className="eyebrow">Your account</p>
      <h1>Download your data or delete your account</h1>
      <section className="card" aria-labelledby="what">
        <h2 id="what">What deleting does</h2>
        <ul className="list">
          <li><span className="num">1</span>Everything is deleted: for a teen, their photos, reviews, levels and postcards; for a parent, their links and cheers.</li>
          <li><span className="num">2</span>You have 7 days to change your mind. After that it's gone for good, within {DELETION_DAYS} days at most.</li>
          <li><span className="num">3</span>Plus bought here stops when the account is deleted. Plus from the App Store or Google Play is cancelled in the phone's subscriptions.</li>
        </ul>
        <p className="muted small">Teens can also do this in the app: You, then Delete my account. A parent's account and their teen's account are separate: deleting one leaves the other.</p>
      </section>
      {!session ? (
        <SignIn title="Sign in with the account to download or delete" />
      ) : pending === undefined ? null : (
        <>
          <p className="muted small">Signed in as {session.user.email ?? "you"}.</p>
          {error ? <p className="error" role="alert">{error}</p> : null}
          <button className="btn" onClick={() => void download()}>
            Download my data
          </button>
          {pending ? (
            <section className="card" role="status">
              <h2>Your account will be deleted after {shortDay(pending.deletesAfter.slice(0, 10))}</h2>
              <p className="text2 small">Until then you can keep it.</p>
              <button className="btn primary" disabled={busy} onClick={() => void keep()}>
                Keep my account
              </button>
            </section>
          ) : (
            <>
              <label className="check">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I understand this deletes my account and everything in it
              </label>
              <button className="btn danger-fill" disabled={!confirm || busy} onClick={() => void request()}>
                Delete my account
              </button>
            </>
          )}
          <button className="link" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </>
      )}
    </main>
  );
}

// Brand marks the sign-in buttons must show (Apple and Google guidelines).
function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 17 20" aria-hidden="true" fill="currentColor">
      <path d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.8 2 5.8 1.1 7.4c-1.8 3.2-.5 7.9 1.3 10.5.9 1.3 1.9 2.7 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8s2.3-1.3 3.1-2.6c1-1.5 1.4-2.9 1.4-3-.1 0-2.7-1-2.7-4.3zM11.6 3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.6 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.9l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.8-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

function PlusCard({
  handle,
  status,
  busy,
  onStart,
  onManage,
  onDecide,
}: {
  handle: string;
  status: ParentPlus[number] | null;
  busy: boolean;
  onStart: () => void;
  onManage: () => void;
  onDecide: (requestId: string, approve: boolean) => void;
}) {
  return (
    <section className="card" aria-labelledby="plus">
      <h2 id="plus">Plus</h2>
      {status?.request ? (
        <div className="card ask" role="status">
          <p>
            <strong>{handle} asked to start Plus in the app.</strong>
          </p>
          <p className="text2 small">
            If you say yes, they can start it within 7 days. It's paid through their App Store or Google Play account, at the store's price, and
            renews monthly until they cancel it in their phone's subscriptions.
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => onDecide(status.request!.id, true)}>
              Say yes
            </button>
            <button className="btn" onClick={() => onDecide(status.request!.id, false)}>
              Not now
            </button>
          </div>
        </div>
      ) : null}
      {status?.included ? (
        <p className="text2">Plus is included free for ages 13–15: deeper coaching and a second take on each quest. There's nothing to buy.</p>
      ) : status?.active ? (
        <>
          <p className="text2">{plusLine(status.until, status.source)}</p>
          {status.source === "web" ? (
            <button className="btn" disabled={busy} onClick={onManage}>
              Manage or cancel
            </button>
          ) : (
            <p className="muted small">Bought in the app store: manage it in that store's subscriptions.</p>
          )}
        </>
      ) : (
        <>
          <ul className="list">
            {PLUS.perks.map((p) => (
              <li key={p}>
                <span className="tick" aria-hidden>✓</span>
                {p}
              </li>
            ))}
          </ul>
          <p className="muted small">
            ${PLUS.monthlyUsd} a month per teen · extra teens ${PLUS.extraTeenUsd}, plus tax where it applies (prices to test). Cancel any time.
          </p>
          <button className="btn primary" disabled={busy} onClick={onStart}>
            Start Plus
          </button>
        </>
      )}
    </section>
  );
}
