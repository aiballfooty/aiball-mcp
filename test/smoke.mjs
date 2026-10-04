// Smoke test: start the server over stdio, list tools, call each one against the live API.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["src/index.js"] }));
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => `${t.name}[ro=${t.annotations?.readOnlyHint}]`).join(", "));
const calls = [
  ["get_open_record", {}],
  ["get_daily_record", { date: "2026-09-30" }],
  ["get_weekly_record", { week_start: "2026-09-21", lang: "ms" }],
  ["list_leagues", {}],
  ["list_recorded_matches", { league: "Premier League", result: "miss", page_size: 2 }],
  ["list_recorded_matches", { league: "No Such League" }],
];
let bad = 0;
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  const leaked = /leagueKey|matchNo|"market|odds|[一-鿿]/.test(text);
  if (leaked) bad++;
  console.log(`${name} ${JSON.stringify(args)} -> isError=${!!r.isError} bytes=${text.length} leaked=${leaked}\n   ${text.slice(0, 260)}`);
}
await client.close();
process.exit(bad ? 1 : 0);
