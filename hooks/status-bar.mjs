// Status Bar: reads the usage figures. The meters themselves are drawn by the
// mod bar's toolbar (rings on the desktop, bars in the terminal) while this mod
// is on; this module keeps only the footer status line, for a session where no
// band is drawn at all (no surface attached).

const PROFILES = {
  ".claude": "work",
  ".claude-personal": "personal",
  ".claude-free": "free",
  ".claude-tiered": "tiered",
  ".claude-pro": "pro",
  ".claude-local": "local",
};
const WINDOWS = { five_hour: "5h", seven_day: "7d", spend_limit: "spend" };
const REFRESH_MS = 60 * 1000;

let account = null; // { label, email }
let timer = null;
// What the last refresh read, for the desktop row to draw.
let snap = null; // { usage, model, now, errors }


export function register(on) {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    account = await readAccount($).catch(() => null);
    await refresh($);
    if (timer === null) {
      timer = $.clock.every(REFRESH_MS, () => refresh($));
    }
    return r;
  });

  on("session.measure", async ($, e, next) => {
    const r = await next(e);
    await refresh($);
    return r;
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    if (!e.agentId) {
      await refresh($);
    }
    return r;
  });
}

async function readAccount($) {
  const configDir = (await $.env.get("CLAUDE_CONFIG_DIR")) ?? "";
  const home = (await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME")) ?? "";
  const leaf = configDir ? configDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : ".claude";
  const label = PROFILES[leaf.toLowerCase()] ?? leaf.replace(/^\.claude-?/, "") ?? leaf;
  // The default profile keeps its account in ~/.claude.json; the others in their own folder.
  const file = configDir ? `${configDir.replace(/[\\/]+$/, "")}/.claude.json` : `${home}/.claude.json`;
  let email = null;
  try {
    const json = JSON.parse(await $.fs.read(file));
    email = json?.oauthAccount?.emailAddress ?? null;
  } catch {
    email = null;
  }
  return { label, email };
}

function prettyModel(id) {
  if (!id) return "claude";
  const big = /\[1m\]/i.test(id) ? " 1M" : "";
  const base = id.replace(/\[.*?\]/g, "");
  const m = base.match(/^(?:claude-)?(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i);
  if (m) {
    return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? "." + m[3] : ""}${big}`;
  }
  const alias = base.match(/^(opus|sonnet|haiku|fable)$/i);
  if (alias) {
    return `${alias[1][0].toUpperCase()}${alias[1].slice(1).toLowerCase()}${big}`;
  }
  return `${base}${big}`;
}

function tone(percent) {
  return percent >= 80 ? { dot: "🔴", hex: "#e5534b" } : percent >= 50 ? { dot: "🟡", hex: "#d4a72c" } : { dot: "🟢", hex: "#46a758" };
}

function textBar(percent, width = 10) {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * width);
  return `${tone(percent).dot} ${"▰".repeat(filled)}${"▱".repeat(width - filled)} ${Math.round(percent)}%`;
}

function untilReset(iso, now) {
  if (!iso) return "";
  const secs = Math.floor((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(secs) || secs <= 0) return "";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d > 0 ? `↻${d}d${h}h` : `↻${h}h${m}m`;
}

function accountText() {
  return account?.email ? `[${account.label}] ${account.email}` : `[${account?.label ?? "?"}]`;
}

// ---- Terminal: the status line -------------------------------------------------

function statusLine(s) {
  const parts = [];
  if (s.errors.length > 0) parts.push(`⚠ ${s.errors.join("; ")}`);
  if (s.usage && s.usage.rateLimits?.length > 0) {
    for (const w of s.usage.rateLimits) {
      const reset = untilReset(w.resetsAt, s.now);
      parts.push(`${WINDOWS[w.kind] ?? w.kind} ${textBar(w.percentUsed)}${reset ? " " + reset : ""}`);
    }
  } else if (s.usage?.cost !== undefined) {
    parts.push(`$${s.usage.cost.usd.toFixed(2)} this session`);
  } else {
    parts.push("usage: n/a yet");
  }
  if (s.usage?.context?.percent !== undefined) parts.push(`ctx ${s.usage.context.percent}%`);
  parts.push(prettyModel(s.model));
  parts.push(accountText());
  return parts.join("  │  ");
}

// ---- Refresh -------------------------------------------------------------------

async function refresh($) {
  // Each part is read on its own, so one failure shows as a warning instead of hiding the line.
  const errors = [];
  const attempt = async (what, fn, fallback) => {
    try {
      return await fn();
    } catch (error) {
      errors.push(`${what}: ${String(error?.message ?? error).slice(0, 80)}`);
      return fallback;
    }
  };
  if (account === null) {
    account = await attempt("account", () => readAccount($), null);
  }
  const usage = await attempt("usage", () => $.session.usage(), null);
  const model = await attempt("model", () => $.session.model(), "");
  const now = await attempt("clock", () => $.clock.now(), Date.now());
  const surfaces = await attempt("surfaces", () => $.session.surfaces(), []);
  const settings = await attempt("settings", () => $.settings.read(), {});
  const isLight = /light/i.test(String(settings?.theme ?? ""));
  snap = { usage, model, now, errors, isLight };
  // The terminal reads the footer line; a desktop-only session draws the row instead.
  // The status now heads the panel above the prompt on every surface, so the
  // footer line (drawn by the terminal as a yellow warning) is only used when
  // nothing draws a panel at all.
  $.ui.status(surfaces.length === 0 ? statusLine(snap) : undefined);
  $.ui.invalidate("ui.render");
}
