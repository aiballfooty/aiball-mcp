// Smoke test: start the server over stdio, list tools, call each one against the live API,
// and check that every key in every response is on the published whitelist.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ALLOWED = new Set(("date tz count matches match_id kickoff_at league home_team away_team status has_snapshot locked " +
  "models_available models balanced home draw away most_likely confidence pre_match_favourite snapshot captured_at source " +
  "result home_score away_score actual hit scope since until n hits hit_rate favourite_baseline random_baseline " +
  "confidence_bands band min_band_sample snapshots auto backfill locked_since week_start week_end coverage expected snapshotted missing match_ids " +
  "source_url disclaimer").split(" "));
const BANNED = /odds|handicap|kelly|\bbet|matchNo|leagueKey|[一-鿿]/i;

function keys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
}

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/index.js"] }));
const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort().join(",");
let bad = 0;
if (names !== "get_match_analysis,get_open_record,list_matches") { console.log("unexpected tools:", names); bad++; }
for (const t of tools) if (!t.title || t.annotations?.readOnlyHint !== true) { console.log("missing title/readOnlyHint:", t.name); bad++; }

async function call(name, args, expectError = false) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  let extra = [];
  if (!r.isError) extra = [...keys(JSON.parse(text))].filter((k) => !ALLOWED.has(k));
  const problem = Boolean(r.isError) !== expectError || extra.length > 0 || BANNED.test(text);
  if (problem) bad++;
  console.log(`${problem ? "FAIL" : "ok  "} ${name} ${JSON.stringify(args)} bytes=${text.length}${extra.length ? " extra=" + extra : ""}\n     ${text.slice(0, 200)}`);
  return r.isError ? null : JSON.parse(text);
}

const day = await call("list_matches", { date: "2026-09-30" });
await call("list_matches", { date: "2026-09-30", league: "UEFA Nations League", lang: "ms" });
if (day?.matches?.[0]) await call("get_match_analysis", { match_id: day.matches[0].match_id });
const week = await call("get_open_record", { week_start: "2026-09-21" });
if (week?.match_ids?.[3]) await call("get_match_analysis", { match_id: week.match_ids[3] });
await call("get_open_record", {});
await call("get_match_analysis", { match_id: "no-such-id" }, true);
await client.close();
console.log(bad ? `${bad} problem(s)` : "all checks passed");
process.exit(bad ? 1 : 0);
