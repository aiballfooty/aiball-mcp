#!/usr/bin/env node
// AI Ball MCP server (stdio). Read-only: it only calls the public AI Ball record API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.AIBALL_API_BASE || "https://aiball.samagent.ai/api/v1").replace(/\/$/, "");
const SITE = "https://aiball.samagent.ai";
const DISCLAIMER = "For information only. Not advice. 18+.";
const VERSION = "0.1.0";
const LANG = z.enum(["en", "ms"]).default("en").describe("Language for league and team names: en (English) or ms (Malay).");
const TZ = z.string().default("Asia/Kuala_Lumpur").describe("IANA time zone that decides which calendar day a match belongs to.");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date as YYYY-MM-DD.");

// Internal-only fields that never leave this server.
const DROP = new Set(["leagueKey", "matchNo", "mode"]);
// Neutral names for the comparison baseline.
const RENAME = { market: "favouriteBaseline", marketFavorite: "preMatchFavourite", marketHits: "favouriteHits" };

function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (DROP.has(k)) continue;
      out[RENAME[k] || k] = clean(val);
    }
    return out;
  }
  return v;
}

async function api(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": `aiball-mcp/${VERSION}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`AI Ball API returned HTTP ${res.status} for ${path}`);
  return clean(await res.json());
}

function ok(data, page, lang = "en") {
  const body = { ...data, source_url: `${SITE}/${lang}${page}?src=mcp`, disclaimer: DISCLAIMER };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

function fail(err) {
  return { isError: true, content: [{ type: "text", text: `Could not reach AI Ball: ${err.message}` }] };
}

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const server = new McpServer({ name: "aiball-mcp", title: "AI Ball — AI football match analysis", version: VERSION });

server.registerTool(
  "get_daily_record",
  {
    title: "Get one day of matches",
    description:
      "Matches for one calendar day with the model's pre-kick-off outcome probabilities (home / draw / away, fractions that sum to 1). " +
      "`upcoming` are locked before kick-off, `pending` are current reads that may still change, `finished` carry the final score and whether the model's most likely outcome happened (`hit`). " +
      "`day` counts how many finished matches went the model's way, next to two baselines on the same matches: always taking the pre-match favourite, and one in three.",
    inputSchema: { date: DATE.optional().describe("YYYY-MM-DD. Defaults to today in `tz`."), tz: TZ, lang: LANG },
    annotations: { title: "Get one day of matches", ...RO },
  },
  async ({ date, tz, lang }) => {
    try { return ok(await api("/record/daily", { date, tz, lang }), "/record", lang); } catch (e) { return fail(e); }
  }
);

server.registerTool(
  "get_weekly_record",
  {
    title: "Get one week of the open record",
    description:
      "One Monday-to-Sunday week: every finished match with the pre-kick-off probabilities and the result, the week's count of matches that went the model's way, and the same count by confidence band. " +
      "`hitRate` is a percentage; null means the sample is too small to quote, so report the counts instead.",
    inputSchema: { week_start: DATE.optional().describe("Monday of the week, YYYY-MM-DD. Defaults to the current week."), tz: TZ, lang: LANG },
    annotations: { title: "Get one week of the open record", ...RO },
  },
  async ({ week_start, tz, lang }) => {
    try { return ok(await api("/record/weekly", { week_start, tz, lang }), "/record", lang); } catch (e) { return fail(e); }
  }
);

server.registerTool(
  "get_open_record",
  {
    title: "Get the open record summary",
    description:
      "The whole public record since it started: matches counted, how many went the model's way, the same matches scored by always taking the pre-match favourite and by one in three, " +
      "and the breakdown by confidence band. Misses are counted the same way as hits; nothing is removed after the fact.",
    inputSchema: {},
    annotations: { title: "Get the open record summary", ...RO },
  },
  async () => {
    try { return ok(await api("/record/summary"), "/record"); } catch (e) { return fail(e); }
  }
);

server.registerTool(
  "list_leagues",
  {
    title: "List leagues in the record",
    description: "Leagues and competitions that have finished matches in the open record, with the number of matches for each. Use a returned `name` as the `league` filter of list_recorded_matches.",
    inputSchema: { lang: LANG },
    annotations: { title: "List leagues in the record", ...RO },
  },
  async ({ lang }) => {
    try {
      // The API filters by its internal league key, so keep a name -> key map on the server side only.
      const raw = await rawLeagues(lang);
      return ok({ leagues: raw.map(({ name, n }) => ({ name, n })) }, "/record", lang);
    } catch (e) { return fail(e); }
  }
);

async function rawLeagues(lang) {
  const url = new URL(BASE + "/record/leagues");
  url.searchParams.set("lang", lang);
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": `aiball-mcp/${VERSION}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`AI Ball API returned HTTP ${res.status} for /record/leagues`);
  return (await res.json()).leagues || [];
}

server.registerTool(
  "list_recorded_matches",
  {
    title: "List finished matches in the record",
    description:
      "Finished matches from the open record, newest first, each with the pre-kick-off probabilities, the final score and whether the model's most likely outcome happened. " +
      "Filter by league name (from list_leagues) and by result.",
    inputSchema: {
      league: z.string().optional().describe("League name exactly as returned by list_leagues, e.g. \"Premier League\"."),
      result: z.enum(["all", "hit", "miss"]).default("all").describe("all, or only matches the model got right (hit) or wrong (miss)."),
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(50).default(20),
      lang: LANG,
    },
    annotations: { title: "List finished matches in the record", ...RO },
  },
  async ({ league, result, page, page_size, lang }) => {
    try {
      let key;
      if (league) {
        const leagues = await rawLeagues(lang);
        const hit = leagues.find((l) => l.name.toLowerCase() === league.toLowerCase());
        if (!hit) return { isError: true, content: [{ type: "text", text: `Unknown league "${league}". Call list_leagues for the valid names.` }] };
        key = hit.key;
      }
      const data = await api("/record/matches", { league: key, result, page, pageSize: page_size, lang });
      data.filters = { league: league || null, result };
      return ok(data, "/record", lang);
    } catch (e) { return fail(e); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
