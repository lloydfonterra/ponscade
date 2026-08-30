const PREFIX = "ponscade.v3";

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function key(name) {
  return `${PREFIX}.${name}`;
}

function read(name, fallback) {
  try {
    const raw = localStorage.getItem(key(name));
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(name, value) {
  localStorage.setItem(key(name), JSON.stringify(value));
}

export const TURNS_PER_DAY = 10;
export const AIRDROP_MIN = 666_666;
export const TOP_N = 10;
export const TOP10_BPS = [20, 15, 12, 10, 9, 8, 7, 7, 6, 6];

export function todayKey() {
  return utcDate();
}

export function loadSession() {
  return read("session", null);
}

export function saveSession(session) {
  write("session", session);
}

export function clearSession() {
  localStorage.removeItem(key("session"));
}

function loadRegistry() {
  return read("registry", { wallets: {}, names: {} });
}

function saveRegistry(reg) {
  write("registry", reg);
}

export function lookupWallet(address) {
  const id = address.trim().toLowerCase();
  return loadRegistry().wallets[id] || null;
}

/**
 * One wallet → one username, forever.
 * Same wallet + same name = return visit (login).
 * Same wallet + new name = rejected.
 * New wallet + taken name = rejected.
 */
export function registerOrEnter({ username, address }) {
  const name = username.trim();
  const addr = address.trim();
  const nameKey = name.toLowerCase();
  const addrKey = addr.toLowerCase();
  const reg = loadRegistry();
  const existingWallet = reg.wallets[addrKey];
  const nameOwner = reg.names[nameKey];

  if (existingWallet) {
    if (existingWallet.username.toLowerCase() !== nameKey) {
      return {
        ok: false,
        error: `This wallet is already registered as ${existingWallet.username}. Registering again is not possible.`,
      };
    }
    const session = { username: existingWallet.username, address: existingWallet.address };
    saveSession(session);
    return { ok: true, session, returning: true };
  }

  if (nameOwner && nameOwner !== addrKey) {
    return {
      ok: false,
      error: `Username ${name} is taken. A wallet can only register once.`,
    };
  }

  const record = { username: name, address: addr, registeredAt: Date.now() };
  reg.wallets[addrKey] = record;
  reg.names[nameKey] = addrKey;
  saveRegistry(reg);
  const session = { username: name, address: addr };
  saveSession(session);
  return { ok: true, session, returning: false };
}

export function loadDay(address) {
  const id = (address || "").toLowerCase();
  const all = read("days", {});
  const date = utcDate();
  const rec = all[`${date}:${id}`];
  if (!rec || rec.date !== date) {
    return { date, address: id, username: "", used: 0, best: {} };
  }
  return rec;
}

export function saveDay(rec) {
  const all = read("days", {});
  all[`${rec.date}:${rec.address}`] = rec;
  write("days", all);
}

export function spendPlay(address, username) {
  const rec = loadDay(address);
  rec.used += 1;
  rec.username = username || rec.username;
  saveDay(rec);
  return rec;
}

export function recordRun(address, username, cabinet, stages, score) {
  const rec = loadDay(address);
  rec.username = username || rec.username;
  const prev = rec.best[cabinet] || { stages: 0, score: 0 };
  if (stages > prev.stages || (stages === prev.stages && score > prev.score)) {
    rec.best[cabinet] = { stages, score };
  }
  saveDay(rec);
  return rec;
}

export function dailyScore(rec) {
  return Object.values(rec.best || {}).reduce(
    (sum, row) => ({
      stages: sum.stages + (row.stages || 0),
      score: sum.score + (row.score || 0),
    }),
    { stages: 0, score: 0 },
  );
}

export function loadBoard() {
  const date = utcDate();
  const all = read("days", {});
  return Object.values(all)
    .filter((row) => row.date === date)
    .map((row) => ({
      address: row.address,
      username: row.username || "anon",
      ...dailyScore(row),
      cabinets: Object.keys(row.best || {}).length,
    }))
    .filter((row) => row.stages > 0)
    .sort((a, b) => b.stages - a.stages || b.score - a.score)
    .slice(0, TOP_N);
}

export function prizeSplit(budget) {
  return TOP10_BPS.map((pct) => Math.floor((budget * pct) / 100));
}

export function isAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isUsername(value) {
  return /^[a-zA-Z0-9_]{2,16}$/.test(value.trim());
}
