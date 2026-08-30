import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PONSCADE_TOKEN,
  PONS_TOKEN,
  CLAIMER_ADDRESS,
  OPERATOR_ADDRESS,
  POT_ADDRESS,
  FEE_ESCROW,
  PONS_FACTORY,
  DEAD_ADDRESS,
  shortAddr,
  explorerAddress,
  explorerToken,
  explorerTx,
} from "./chain.js";
import {
  AIRDROP_MIN,
  CLAIM_MINUTES,
  TURNS_PER_DAY,
  TOP_N,
  TOP10_BPS,
  clearSession,
  dailyScore,
  isAddress,
  isUsername,
  loadBoard,
  loadDay,
  loadSession,
  prizeSplit,
  recordRun,
  registerOrEnter,
  spendPlay,
  todayKey,
} from "./store.js";
import Volt from "./games/Volt.jsx";
import Breaker from "./games/Breaker.jsx";
import Orbit from "./games/Orbit.jsx";

const GAMES = {
  volt: {
    id: "volt",
    name: "VOLT",
    blurb: "Eat orbs. Five clears a stage.",
    tag: "Snake",
    controls: "WASD or arrows",
  },
  breaker: {
    id: "breaker",
    name: "BREAKER",
    blurb: "Clear the wall. Walls get denser.",
    tag: "Breakout",
    controls: "A · D or arrows",
  },
  orbit: {
    id: "orbit",
    name: "ORBIT",
    blurb: "Turn, thrust, shoot. Survive the wave.",
    tag: "Arena",
    controls: "A · D · W · Space",
  },
};

const DAILY_BUDGET = 12000;
const X_URL = "https://x.com/PonscadeRH";

function useEpochUtc() {
  const [clock, setClock] = useState(() => epochClock());
  useEffect(() => {
    const id = setInterval(() => setClock(epochClock()), 1000);
    return () => clearInterval(id);
  }, []);
  return clock;
}

function epochClock() {
  const now = new Date();
  const window = CLAIM_MINUTES * 60;
  const into = (now.getUTCMinutes() % CLAIM_MINUTES) * 60 + now.getUTCSeconds();
  let left = window - into;
  if (left === window) left = 0;
  const m = Math.floor(left / 60);
  const s = left % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

function useMidnightUtc() {
  const [clock, setClock] = useState(() => utcClock());
  useEffect(() => {
    const id = setInterval(() => setClock(utcClock()), 1000);
    return () => clearInterval(id);
  }, []);
  return clock;
}

function utcClock() {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  let ms = Math.max(0, next - now.getTime());
  const h = Math.floor(ms / 3_600_000);
  ms %= 3_600_000;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function App() {
  const [view, setView] = useState("land");
  const [session, setSession] = useState(() => loadSession());
  const [nameDraft, setNameDraft] = useState("");
  const [addrDraft, setAddrDraft] = useState("");
  const [error, setError] = useState("");
  const [day, setDay] = useState(() => loadDay(loadSession()?.address || ""));
  const [board, setBoard] = useState(() => loadBoard());
  const [active, setActive] = useState(null);
  const [lastRun, setLastRun] = useState(null);
  const [copied, setCopied] = useState("");
  const payoutIn = useMidnightUtc();
  const epochIn = useEpochUtc();
  const [lastClaim, setLastClaim] = useState(null);
  useEffect(() => {
    fetch("/last-claim.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setLastClaim)
      .catch(() => setLastClaim(null));
  }, []);

  const copyText = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setCopied("");
    }
  };

  const remaining = Math.max(0, TURNS_PER_DAY - day.used);
  const mine = dailyScore(day);
  const prizes = prizeSplit(DAILY_BUDGET);

  useEffect(() => {
    if (!session) return;
    setDay(loadDay(session.address));
    setBoard(loadBoard());
  }, [session]);

  useEffect(() => {
    if (view !== "arcade" && view !== "board") return;
    const tick = () => setBoard(loadBoard());
    tick();
    const id = setInterval(tick, 4000);
    return () => clearInterval(id);
  }, [view]);

  const goArcade = () => {
    setError("");
    if (!session) {
      setView("checkin");
      return;
    }
    setView("arcade");
  };

  const checkIn = (e) => {
    e.preventDefault();
    setError("");
    const username = nameDraft.trim();
    const address = addrDraft.trim();
    if (!isUsername(username)) {
      setError("Username: 2–16 letters, numbers, or underscore.");
      return;
    }
    if (!isAddress(address)) {
      setError("Wallet must be a Robinhood Chain address: 0x and 40 hex characters.");
      return;
    }
    const result = registerOrEnter({ username, address });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSession(result.session);
    setDay(loadDay(result.session.address));
    setView("arcade");
  };

  const signOut = () => {
    clearSession();
    setSession(null);
    setActive(null);
    setView("land");
  };

  const startGame = (id) => {
    setError("");
    if (!session) {
      setView("checkin");
      return;
    }
    if (remaining <= 0) {
      setError(`This wallet has used all ${TURNS_PER_DAY} turns today. Come back after 00:00 UTC.`);
      return;
    }
    spendPlay(session.address, session.username);
    setDay(loadDay(session.address));
    setActive(id);
    setLastRun(null);
    setView("play");
  };

  const finish = useCallback(
    ({ stages, score }) => {
      if (!session || !active) return;
      recordRun(session.address, session.username, active, stages, score);
      setDay(loadDay(session.address));
      setBoard(loadBoard());
      setLastRun({ stages, score, cabinet: active });
    },
    [session, active],
  );

  const Game = useMemo(() => {
    if (active === "volt") return Volt;
    if (active === "breaker") return Breaker;
    if (active === "orbit") return Orbit;
    return null;
  }, [active]);

  const chrome = view !== "checkin";

  return (
    <div className="app" data-view={view}>
      {chrome && view !== "land" && <div className="floor-atmos" aria-hidden />}
      {view === "land" && <div className="home-atmos" aria-hidden />}

      {chrome && (
        <header className="top">
          <button className="logo" onClick={() => { setView("land"); setActive(null); }}>
            <img className="mark" src="/logo.png" alt="" />
            <span>PONSCADE</span>
          </button>
          <nav>
            <button className={view === "arcade" || view === "play" ? "on" : ""} onClick={goArcade}>Games</button>
            <button className={view === "board" ? "on" : ""} onClick={() => setView("board")}>Leaderboard</button>
            <button
              className={view === "how" ? "on" : ""}
              onClick={() => {
                if (view === "land") {
                  document.getElementById("protocol")?.scrollIntoView({ behavior: "smooth" });
                  return;
                }
                setView("how");
              }}
            >
              How to play
            </button>
            <a className="x-link" href={X_URL} target="_blank" rel="noreferrer">X</a>
          </nav>
          {session ? (
            <div className="session">
              <span className="avatar" aria-hidden>{session.username.slice(0, 1).toUpperCase()}</span>
              <span className="who" title={session.address}>{session.username}</span>
              <button className="wallet ghost" onClick={signOut}>Log out</button>
            </div>
          ) : (
            <button className="wallet solid" onClick={() => setView("checkin")}>
              Check in
            </button>
          )}
        </header>
      )}

      {error && <div className="banner">{error}</div>}

      {view === "land" && (
        <section className="home">
          <div className="poster-wrap">
            <p className="home-eyebrow">Robinhood Chain</p>
            <h1 className="poster">Ponscade</h1>
            <p className="home-sub">Hold. Play. Win the pot.</p>
            <p className="home-lede">
              Every Ponscade fee is split <strong className="tok-min">10% pot</strong>
              {" · "}
              <strong className="tok-min">10% burn</strong>
              {" · "}
              <strong className="tok-min">80%</strong> buys{" "}
              <strong className="tok-pons">$PONS</strong> for{" "}
              <strong className="tok-cade">$PONSCADE</strong> holders.
              The more you hold, the larger your share — minimum{" "}
              <strong className="tok-min">{AIRDROP_MIN.toLocaleString()}</strong>{" "}
              <strong className="tok-cade">$PONSCADE</strong>. Play the free arcade
              for the midnight pot. One wallet, one name. No connect.
            </p>
            <div className="home-cta">
              <button className="btn-hot" onClick={goArcade}>Enter arcade</button>
              <button className="btn-ghost" onClick={() => setView("board")}>Leaderboard</button>
              <a className="btn-ghost" href={X_URL} target="_blank" rel="noreferrer">@PonscadeRH</a>
            </div>
            <div className="ca-pill">
              <span>CA</span>
              <code>{PONSCADE_TOKEN ? shortAddr(PONSCADE_TOKEN) : "after launch"}</code>
              <button
                type="button"
                disabled={!PONSCADE_TOKEN}
                onClick={() => PONSCADE_TOKEN && copyText(PONSCADE_TOKEN, "token")}
              >
                {copied === "token" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="home-cabs">
            {Object.values(GAMES).map((g) => (
              <article key={g.id} className={`machine machine-${g.id}`}>
                <div className="machine-marquee">{g.name}</div>
                <div className="machine-bezel">
                  <CabinetArt id={g.id} />
                  <div className="machine-scan" />
                </div>
                <div className="machine-deck">
                  <p>{g.blurb}</p>
                  <div className="machine-meta">
                    <small>{g.tag}</small>
                    <small>{g.controls}</small>
                  </div>
                  <button type="button" onClick={() => startGame(g.id)}>
                    Play
                  </button>
                </div>
              </article>
            ))}
          </div>

          <p className="sec-kicker">The flywheel</p>
          <h2 className="sec-title">How the fees move</h2>
          <p className="home-lede wide">
            Trading <strong className="tok-cade">$PONSCADE</strong> creates creator
            fees. About every {CLAIM_MINUTES} minutes the fee claimer claims that ETH. The operator then splits it:
            10% goes to a separate pot wallet, 10% buys{" "}
            <strong className="tok-cade">$PONSCADE</strong> and burns it, and 80%
            buys <strong className="tok-pons">$PONS</strong> for every wallet holding
            at least <strong className="tok-min">{AIRDROP_MIN.toLocaleString()}</strong>{" "}
            <strong className="tok-cade">$PONSCADE</strong>. Hold more than the
            minimum and your share is larger. At 00:00 UTC the pot pays the top{" "}
            {TOP_N} players.{" "}
            <strong>No staking. No claiming. No signing.</strong>
          </p>

          <div className="stat-xl">
            <div>
              <b>{DAILY_BUDGET.toLocaleString()}</b>
              <span>Pot preview · not live-read yet</span>
            </div>
            <div>
              <b>{epochIn}</b>
              <span>Until the next {CLAIM_MINUTES}-min claim window</span>
            </div>
            <div>
              <b>{payoutIn}</b>
              <span>Until midnight UTC payout</span>
            </div>
            <div>
              <b>{TURNS_PER_DAY}</b>
              <span>Turns per wallet per day</span>
            </div>
          </div>

          <LastDrop data={lastClaim} />

          <ol className="rules">
            <li>
              <span>01</span>
              <div>
                <h3>Hold the line</h3>
                <p>Keep at least {AIRDROP_MIN.toLocaleString()} $PONSCADE to receive the $PONS airdrop.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Play the floor</h3>
                <p>Best run per cabinet. Stages rank you. Score breaks ties.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Get paid</h3>
                <p>Top {TOP_N} are sent ETH from the pot wallet at 00:00 UTC. No claim button.</p>
              </div>
            </li>
          </ol>

          <p className="sec-kicker">The vaults</p>
          <h2 className="sec-title">Three wallets, never the same</h2>
          <p className="home-lede wide">
            Fees land on the claimer. The operator runs the split. The pot only
            pays the board. Three keys. Three jobs.
          </p>
          <div className="vaults">
            <AddrCard
              label="Fee claimer"
              addr={CLAIMER_ADDRESS}
              note="Receives creator fees. Calls claim(). Does not hold the pot."
              copied={copied === "claim"}
              onCopy={() => copyText(CLAIMER_ADDRESS, "claim")}
            />
            <AddrCard
              label="Operator"
              addr={OPERATOR_ADDRESS}
              note="Runs the 10 / 10 / 80 split. Not the fee inbox. Not the prize vault."
              copied={copied === "op"}
              onCopy={() => copyText(OPERATOR_ADDRESS, "op")}
            />
            <AddrCard
              label="Pot vault"
              addr={POT_ADDRESS}
              note="Stacks all day. Pays top 10 at 00:00 UTC. Then ranks wipe."
              copied={copied === "pot"}
              onCopy={() => copyText(POT_ADDRESS, "pot")}
            />
          </div>
          <p className="home-note">
            $PONS{" "}
            <a href={explorerToken(PONS_TOKEN)} target="_blank" rel="noreferrer">{shortAddr(PONS_TOKEN)}</a>
            {" "}· fee escrow{" "}
            <a href={explorerAddress(FEE_ESCROW)} target="_blank" rel="noreferrer">{shortAddr(FEE_ESCROW)}</a>
            {" "}· factory{" "}
            <a href={explorerAddress(PONS_FACTORY)} target="_blank" rel="noreferrer">{shortAddr(PONS_FACTORY)}</a>
          </p>

          <p className="sec-kicker" id="protocol">How it works</p>
          <h2 className="sec-title">A fee becomes a prize</h2>
          <ol className="rules tall">
            <li>
              <span>01</span>
              <div>
                <h3>Trade $PONSCADE on Pons</h3>
                <p>Creator fees in ETH sit on the curve until sweepFees, then the escrow. That ETH is the only input.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Fee claimer claims every {CLAIM_MINUTES} minutes</h3>
                <p>claim() / claimToken on {shortAddr(FEE_ESCROW)} from {shortAddr(CLAIMER_ADDRESS)}. The operator splits after that.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>10% pot · 10% burn · 80% $PONS</h3>
                <p>
                  Pot goes to {shortAddr(POT_ADDRESS)}. Burn goes to {shortAddr(DEAD_ADDRESS)}.
                  $PONS ({shortAddr(PONS_TOKEN)}) goes to holders ≥ {AIRDROP_MIN.toLocaleString()} $PONSCADE.
                </p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h3>Midnight pays skill</h3>
                <p>
                  Top {TOP_N}: {TOP10_BPS.map((p, i) => `#${i + 1} ${p}%`).join(" · ")}.
                  Bot and auto-payout are not wired on this site yet. The rules already are.
                </p>
              </div>
            </li>
          </ol>

          <p className="sec-kicker">Midnight cut</p>
          <h2 className="sec-title">Top {TOP_N} take the pot</h2>
          <div className="cut-list">
            {TOP10_BPS.map((pct, i) => (
              <div key={i} className="cut-row">
                <span>#{i + 1}</span>
                <i style={{ width: `${pct * 4.2}%` }} />
                <b>{pct}%</b>
              </div>
            ))}
          </div>

          <p className="fine home-fine">
            <a href={X_URL} target="_blank" rel="noreferrer">@PonscadeRH</a>
            {" "}· not official Robinhood, Pons Labs, or anyone else’s arcade.
            Tokens can go to zero. Not financial advice.
          </p>
        </section>
      )}

      {view === "checkin" && (
        <section className="scene">
          <div className="stars" />
          <div className="sun" />
          <div className="grid" />
          <form className="crt checkin" onSubmit={checkIn}>
            <div className="crt-screen">
              <div className="scan" />
              <p className="eyebrow">PLAYER CARD</p>
              <h2>Check in</h2>
              <p className="lede">
                A wallet registers once. Same name + same address is how you
                come back. Prizes send themselves — no connect.
              </p>
              <label>
                Username
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="max16chars"
                  autoComplete="username"
                  maxLength={16}
                />
              </label>
              <label>
                Wallet address
                <input
                  value={addrDraft}
                  onChange={(e) => setAddrDraft(e.target.value)}
                  placeholder="0x…"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <div className="cta">
                <button className="enter" type="submit">ENTER ARCADE</button>
              </div>
            </div>
            <div className="crt-chin">
              <i className="knob" />
              <span>PONSCADE</span>
              <i className="grill" />
            </div>
          </form>
        </section>
      )}

      {view === "arcade" && (
        <section className="page floor">
          <div className="floor-hero">
            <div className="floor-copy">
              <p className="kicker">
                <span>Tonight · {todayKey()} UTC</span>
                <span className="kicker-clock">Payout {payoutIn}</span>
              </p>
              <h1>Hold. Play.<br /><span>Win the pot.</span></h1>
              <p className="lede">
                Three cabinets, free in the browser. Best run on each is kept.
                Stages rank you; score breaks ties. Top {TOP_N} are paid at
                00:00 UTC — no claim, no connect.
              </p>
            </div>

            <div className="pot-card">
              <span className="pot-label">Daily pot</span>
              <strong>{DAILY_BUDGET.toLocaleString()}</strong>
              <p className="pot-hint">10% of claimed fees</p>
              <div className="pot-track" aria-hidden>
                <i />
              </div>
              <p className="pot-foot">Resets midnight UTC</p>
            </div>
          </div>

          <div className="rail">
            <div>
              <small>Turns left</small>
              <b>{remaining}<em>/{TURNS_PER_DAY}</em></b>
            </div>
            <div>
              <small>Your stages</small>
              <b>{mine.stages}</b>
              <span>{mine.score.toLocaleString()} pts</span>
            </div>
            <div>
              <small>Payout</small>
              <b>Top {TOP_N}</b>
              <span>Sent to your wallet</span>
            </div>
            <div>
              <small>Board</small>
              <b>{board.length || "—"}</b>
              <span>
                {board.length === 0
                  ? "Empty — be first"
                  : board.length === 1
                    ? "Player tonight"
                    : "Players tonight"}
              </span>
            </div>
          </div>

          <div className="section-head" id="cabinets">
            <h3>Pick your cabinet</h3>
            <p>One turn each time you play. A better run on that cabinet replaces the last.</p>
          </div>

          <div className="cabinets">
            {Object.values(GAMES).map((g) => (
              <article key={g.id} className={`machine machine-${g.id}`}>
                <div className="machine-marquee">{g.name}</div>
                <div className="machine-bezel">
                  <CabinetArt id={g.id} />
                  <div className="machine-scan" />
                </div>
                <div className="machine-deck">
                  <p>{g.blurb}</p>
                  <div className="machine-meta">
                    <small>{g.tag}</small>
                    <small>{g.controls}</small>
                  </div>
                  <button type="button" onClick={() => startGame(g.id)}>
                    Play
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div className="floor-board">
            <div className="floor-board-head">
              <p className="kicker">Live ranks · {todayKey()} UTC</p>
              <h2>Top {TOP_N} tonight</h2>
              <p className="lede">Updates after every run. Paid at midnight UTC.</p>
            </div>
            <BoardTable
              board={board}
              prizes={prizes}
              highlight={session?.address}
            />
          </div>
        </section>
      )}

      {view === "play" && Game && (
        <section className="page play-wrap">
          <button className="back-link" type="button" onClick={() => setView("arcade")}>
            ← Floor
          </button>
          <div className={`play-frame play-${active}`}>
            <Game onOver={finish} />
          </div>
          {lastRun && (
            <div className="result">
              <p>
                {GAMES[lastRun.cabinet].name}: stage {lastRun.stages} · {lastRun.score} pts
              </p>
              <button className="btn primary" onClick={() => setView("arcade")}>
                Back to floor
              </button>
              <button className="btn quiet" onClick={() => setView("board")}>See board</button>
            </div>
          )}
        </section>
      )}

      {view === "how" && (
        <section className="page how-page">
          <header className="how-head">
            <p className="kicker">Rules of the floor</p>
            <h2>How Ponscade works</h2>
            <p className="lede">
              Type a username and wallet. We never ask you to connect. One
              wallet can register once. Each wallet gets {TURNS_PER_DAY} turns
              per UTC day. If you finish top 10, the pot is sent to that
              address automatically.
            </p>
          </header>
          <ol className="steps">
            <li>
              <span>01</span>
              <div>
                <h3>We launch $PONSCADE on Pons</h3>
                <p>
                  Trades pay us creator fees in ETH. A bot claims those fees
                  every {CLAIM_MINUTES} minutes.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>10% → daily pot wallet</h3>
                <p>
                  Claimed ETH goes to a vault that is not the creator wallet.
                  It stacks all day. At 00:00 UTC that vault pays the top 10,
                  then ranks reset.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>10% → buyback and burn</h3>
                <p>Buys $PONSCADE and sends it to dead. Supply shrinks.</p>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                <h3>80% → buy $PONS, airdrop to holders</h3>
                <p>
                  That share buys{" "}
                  <a
                    href={`https://robinhoodchain.blockscout.com/token/${PONS_TOKEN}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    $PONS
                  </a>{" "}
                  ({shortAddr(PONS_TOKEN)}). Those $PONS go to every wallet
                  holding at least{" "}
                  <strong>{AIRDROP_MIN.toLocaleString()}</strong> $PONSCADE.
                  Below that, nothing.
                </p>
              </div>
            </li>
            <li>
              <span>05</span>
              <div>
                <h3>Skill board</h3>
                <p>
                  One point per stage. Best run per cabinet, added together.
                  Top 10 paid, everyone else starts over tomorrow.
                </p>
              </div>
            </li>
          </ol>
          <div className="split-card">
            <h3>Top 10 split</h3>
            <div className="split-bars">
              {TOP10_BPS.map((pct, i) => (
                <div key={i}>
                  <span>#{i + 1}</span>
                  <i style={{ height: `${28 + pct * 3.2}px` }} />
                  <b>{pct}%</b>
                </div>
              ))}
            </div>
          </div>
          <p className="fine">
            Follow{" "}
            <a href={X_URL} target="_blank" rel="noreferrer">@PonscadeRH</a>.
            Not affiliated with Robinhood, Pons Labs, Webcade, or PonsMe.
            Tokens can go to zero. This is not financial advice.
            {PONSCADE_TOKEN ? ` Token ${shortAddr(PONSCADE_TOKEN)}.` : ""}
          </p>
        </section>
      )}

      {view === "board" && (
        <section className="page board-page">
          <header className="how-head">
            <p className="kicker">
              Payout {payoutIn} · {todayKey()} UTC
            </p>
            <h2>Top {TOP_N} tonight</h2>
            <p className="lede">
              Paid automatically to the registered wallets. No connect.
              Board wipes at midnight UTC.
            </p>
          </header>
          <BoardTable
            board={board}
            prizes={prizes}
            highlight={session?.address}
          />
        </section>
      )}

      <footer>
        Ponscade 2026 of Ponsfamily
      </footer>
    </div>
  );
}

function fmtAmt(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return n;
  return x.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function LastDrop({ data }) {
  if (!data?.airdrops?.length) return null;
  const when = data.at ? new Date(data.at).toUTCString() : "";
  const links = [
    ["Claim", data.txs?.claim],
    ["Pot 10%", data.txs?.pot],
    ["Buy $PONS", data.txs?.swap],
  ].filter(([, h]) => h);
  return (
    <div className="last-drop">
      <p className="sec-kicker">Last 15 minutes</p>
      <h2 className="sec-title">Proof of the split</h2>
      <p className="home-lede wide">
        Claimed <strong className="tok-min">{fmtAmt(data.claimedEth)} ETH</strong>.
        10% to the pot. 80% bought{" "}
        <strong className="tok-pons">{fmtAmt(data.ponsBought)} $PONS</strong>{" "}
        for {data.holders} holders with at least{" "}
        {Number(data.minHold).toLocaleString()} $PONSCADE.
        {when ? ` ${when}.` : ""}
      </p>
      <div className="drop-links">
        {links.map(([label, hash]) => (
          <a key={hash} href={explorerTx(hash)} target="_blank" rel="noreferrer">
            {label}
          </a>
        ))}
      </div>
      <div className="drop-table">
        {data.airdrops.map((row) => (
          <div className="drop-row" key={`${row.to}-${row.tx || "keep"}`}>
            <code>{shortAddr(row.to)}</code>
            <b>{fmtAmt(row.amount)} $PONS</b>
            {row.tx ? (
              <a href={explorerTx(row.tx)} target="_blank" rel="noreferrer">tx</a>
            ) : (
              <span>kept</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddrCard({ label, addr, note, href, copied, onCopy }) {
  const link = href || explorerAddress(addr);
  return (
    <article className="addr-card">
      <small>{label}</small>
      <a href={link} target="_blank" rel="noreferrer">{addr}</a>
      <p>{note}</p>
      <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
    </article>
  );
}

function CabinetArt({ id }) {
  if (id === "volt") {
    return (
      <div className="art volt" aria-hidden>
        <span className="art-snake s1" />
        <span className="art-snake s2" />
        <span className="art-orb o1" />
      </div>
    );
  }
  if (id === "breaker") {
    return (
      <div className="art breaker" aria-hidden>
        {["#ff6b6b", "#ffe27a", "#3ee07a", "#7ec8ff"].map((c, i) => (
          <span key={c} className="art-brick" style={{ left: `${12 + i * 22}%`, top: "18%", background: c }} />
        ))}
        {["#ff6b6b", "#ffe27a", "#3ee07a", "#7ec8ff"].map((c, i) => (
          <span key={`${c}b`} className="art-brick" style={{ left: `${12 + i * 22}%`, top: "30%", background: c, opacity: 0.65 }} />
        ))}
        <span className="art-paddle" />
        <span className="art-orb ball" />
      </div>
    );
  }
  return (
    <div className="art orbit" aria-hidden>
      <span className="art-orb star" />
      <span className="art-orb rock" />
      <span className="art-orb threat" />
      <span className="art-ship" />
    </div>
  );
}

function BoardTable({ board, prizes, highlight }) {
  const mine = (highlight || "").toLowerCase();
  if (board.length === 0) {
    return (
      <div className="board-empty">
        Empty floor. Check in and take a cabinet.
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Wallet</th>
            <th>Stages</th>
            <th>Score</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {board.map((row, i) => (
            <tr
              key={row.address}
              className={row.address.toLowerCase() === mine ? "me" : undefined}
            >
              <td>
                <span className={`rank ${i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : ""}`}>
                  {i + 1}
                </span>
              </td>
              <td>
                <span className="player">
                  <i>{row.username.slice(0, 1).toUpperCase()}</i>
                  {row.username}
                </span>
              </td>
              <td className="mono">{shortAddr(row.address)}</td>
              <td>{row.stages}</td>
              <td>{row.score.toLocaleString()}</td>
              <td>
                <span className="share">
                  +{prizes[i].toLocaleString()}
                  <em>· {TOP10_BPS[i]}%</em>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
