#!/usr/bin/env node
// AI Ball MCP server (stdio). Read-only: it only calls the public AI Ball record API
// and returns a fixed whitelist of fields. Nothing from the upstream response is passed through as-is.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.AIBALL_API_BASE || "https://aiball.samagent.ai/api/v1").replace(/\/$/, "");
const SITE = "https://aiball.samagent.ai";
const DISCLAIMER = "For information only. Not advice. 18+.";
const VERSION = "0.3.0";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 500;

const LANG = z.enum(["en", "ms"]).default("en").describe("Language for league and team names: en (English) or ms (Malay).");
const TZ = z.string().default("Asia/Kuala_Lumpur").describe("IANA time zone that decides which calendar day a match belongs to.");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---- upstream access: cached and throttled, so a busy client cannot hammer the public API ----
const cache = new Map();
let lastCall = 0;
let queue = Promise.resolve();

function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const key = url.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.data);
  const run = async () => {
    const again = cache.get(key);
    if (again && Date.now() - again.at < CACHE_TTL_MS) return again.data;
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": `aiball-mcp/${VERSION}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 429) throw new Error("AI Ball is rate limiting requests. Wait a minute and try again.");
    if (!res.ok) throw new Error(`AI Ball API returned HTTP ${res.status}`);
    const data = await res.json();
    cache.set(key, { at: Date.now(), data });
    return data;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

// ---- whitelists ----
const num = (v) => (typeof v === "number" ? v : null);
const str = (v) => (typeof v === "string" ? v : null);
const side = (v) => (v === "home" || v === "draw" || v === "away" ? v : null);

function baseline(b) {
  return b ? { n: num(b.n), hits: num(b.hits), hit_rate: num(b.hitRate) } : null;
}

function counts(o) {
  return {
    n: num(o?.n),
    hits: num(o?.hits),
    hit_rate: num(o?.hitRate),
    favourite_baseline: baseline(o?.market),
    random_baseline: baseline(o?.random),
  };
}

function bands(list) {
  return (Array.isArray(list) ? list : []).map((b) => ({
    band: str(b.key),
    n: num(b.n),
    hits: num(b.hits),
    hit_rate: num(b.hitRate),
    favourite_baseline: baseline(b.market),
  }));
}

function matchRow(m, status) {
  return {
    match_id: str(m.matchId),
    kickoff_at: str(m.kickoffAt),
    league: str(m.league),
    home_team: str(m.homeTeam),
    away_team: str(m.awayTeam),
    status,
    has_snapshot: Boolean(m.capturedAt),
    locked: status !== "pending",
  };
}

function analysis(m, status) {
  const p = m.probabilities || {};
  const finished = status === "finished";
  return {
    match_id: str(m.matchId),
    kickoff_at: str(m.kickoffAt),
    league: str(m.league),
    home_team: str(m.homeTeam),
    away_team: str(m.awayTeam),
    status,
    models_available: ["balanced"],
    models: { balanced: { home: num(p.home), draw: num(p.draw), away: num(p.away) } },
    most_likely: side(m.pick),
    confidence: num(m.confidence),
    pre_match_favourite: side(m.marketFavorite),
    snapshot: { captured_at: str(m.capturedAt), source: str(m.source), locked: status !== "pending" },
    result: finished
      ? { home_score: num(m.homeScore), away_score: num(m.awayScore), actual: side(m.actual), hit: typeof m.hit === "boolean" ? m.hit : null }
      : null,
  };
}

// match_id -> { raw, status }, filled by every listing this process has seen
const seen = new Map();
function remember(list, status) {
  for (const m of Array.isArray(list) ? list : []) if (m?.matchId) seen.set(m.matchId, { raw: m, status });
}

function ok(data, page, lang = "en") {
  const body = { ...data, source_url: `${SITE}/${lang}${page}?src=mcp`, disclaimer: DISCLAIMER };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}
function fail(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const server = new McpServer({ name: "aiball-mcp", title: "AI Ball — AI football match analysis", version: VERSION });

server.registerTool(
  "list_matches",
  {
    title: "List matches for a date",
    description:
      "Matches for one calendar day: match_id, kick-off time (UTC), league, teams and status. " +
      "status is `upcoming` (pre-kick-off read is locked), `pending` (current read, may still change before kick-off) or `finished`. " +
      "Pass a match_id to get_match_analysis for the outcome probabilities and, once played, the result.",
    inputSchema: {
      date: DATE.optional().describe("YYYY-MM-DD. Defaults to today in `tz`."),
      tz: TZ,
      league: z.string().optional().describe("Only matches from this league, by name as shown in the results, e.g. \"Premier League\"."),
      lang: LANG,
    },
    annotations: { title: "List matches for a date", ...RO },
  },
  async ({ date, tz, league, lang }) => {
    try {
      const d = await api("/record/daily", { date, tz, lang });
      const groups = [["upcoming", d.upcoming], ["pending", d.pending], ["finished", d.finished]];
      let matches = [];
      for (const [status, list] of groups) {
        remember(list, status);
        matches = matches.concat((list || []).map((m) => matchRow(m, status)));
      }
      if (league) matches = matches.filter((m) => (m.league || "").toLowerCase() === league.toLowerCase());
      return ok({ date: str(d.date), tz: str(d.tz), count: matches.length, matches }, "/record", lang);
    } catch (e) { return fail(`Could not reach AI Ball: ${e.message}`); }
  }
);

server.registerTool(
  "get_match_analysis",
  {
    title: "Get outcome probabilities for a match",
    description:
      "For one match: the model's home / draw / away probabilities as recorded before kick-off (fractions that sum to 1), its most likely outcome, a confidence score, the pre-match favourite, " +
      "and when the read was captured. For a finished match it also returns the final score and whether the most likely outcome happened (`hit`). " +
      "This version returns the `balanced` model; `models_available` lists what is included.",
    inputSchema: {
      match_id: z.string().min(1).describe("match_id from list_matches."),
      lang: LANG,
    },
    annotations: { title: "Get outcome probabilities for a match", ...RO },
  },
  async ({ match_id, lang }) => {
    try {
      let found = seen.get(match_id);
      if (!found) {
        const today = await api("/record/daily", { lang });
        remember(today.upcoming, "upcoming"); remember(today.pending, "pending"); remember(today.finished, "finished");
        found = seen.get(match_id);
      }
      for (let page = 1; !found && page <= 10; page++) {
        const d = await api("/record/matches", { page, pageSize: 100, lang });
        remember(d.items, "finished");
        found = seen.get(match_id);
        if (page >= (d.totalPages || 1)) break;
      }
      if (!found) return fail(`No match with match_id "${match_id}" in the open record. Use list_matches to get valid ids.`);
      return ok(analysis(found.raw, found.status), "/record", lang);
    } catch (e) { return fail(`Could not reach AI Ball: ${e.message}`); }
  }
);

server.registerTool(
  "get_open_record",
  {
    title: "Get the open record",
    description:
      "How the model's pre-kick-off reads turned out. Without arguments: the whole public record. With `week_start`: one Monday-to-Sunday week. " +
      "Returns matches counted (`n`), how many went the model's way (`hits`), the same matches scored by always taking the pre-match favourite and by one in three, and the breakdown by confidence band. " +
      "`hit_rate` is a percentage; null means the sample is under `min_band_sample`, so quote the counts instead. Misses are counted the same way as hits.",
    inputSchema: {
      week_start: DATE.optional().describe("Monday of the week, YYYY-MM-DD. Omit for the whole record."),
      tz: TZ,
    },
    annotations: { title: "Get the open record", ...RO },
  },
  async ({ week_start, tz }) => {
    try {
      if (week_start) {
        const d = await api("/record/weekly", { week_start, tz, lang: "en" });
        remember(d.matches, "finished");
        return ok({
          scope: "week", week_start: str(d.weekStart), week_end: str(d.weekEnd), tz: str(d.tz),
          ...counts(d), confidence_bands: bands(d.buckets), min_band_sample: num(d.minBucketSample),
          coverage: d.coverage ? { expected: num(d.coverage.expected), snapshotted: num(d.coverage.snapshotted), missing: num(d.coverage.missing) } : null,
          match_ids: (d.matches || []).map((m) => str(m.matchId)),
        }, "/record");
      }
      const d = await api("/record/summary");
      return ok({
        scope: "all", since: str(d.since), until: str(d.until),
        ...counts(d), confidence_bands: bands(d.buckets), min_band_sample: num(d.minBucketSample),
        snapshots: d.snapshots ? { auto: num(d.snapshots.auto), backfill: num(d.snapshots.backfill) } : null,
        locked_since: str(d.lockedSince),
      }, "/record");
    } catch (e) { return fail(`Could not reach AI Ball: ${e.message}`); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
