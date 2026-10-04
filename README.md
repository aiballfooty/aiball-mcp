# AI Ball MCP server

<!-- mcp-name: io.github.aiballfooty/aiball-mcp -->

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server for [AI Ball](https://aiball.samagent.ai/en/?src=mcp), AI football match analysis.

It gives an AI assistant two things:

- **Pre-kick-off outcome probabilities.** For each match, the model's home / draw / away probabilities as recorded before kick-off.
- **The open record.** What happened afterwards: the final score and whether the model's most likely outcome came in. Misses are counted the same way as hits, and nothing is removed after the fact.

No account, no API key. The server only calls AI Ball's public record API.

## Tools

| Tool | What it returns |
|---|---|
| `get_daily_record` | One calendar day: upcoming matches with their probabilities, finished matches with scores and outcomes, and the day's count |
| `get_weekly_record` | One Monday-to-Sunday week of finished matches, with the count by confidence band |
| `get_open_record` | The whole record since it started, next to two baselines on the same matches |
| `list_leagues` | Leagues and competitions in the record, with match counts |
| `list_recorded_matches` | Finished matches, newest first, filterable by league and by hit / miss |

Every tool is read-only (`readOnlyHint: true`). Names are available in English (`lang: "en"`) and Malay (`lang: "ms"`).

### Reading the numbers

- `probabilities` are fractions for `home`, `draw` and `away` that sum to 1.
- `hit` is `true` when the model's most likely outcome happened.
- `hitRate` is a percentage. `null` means the sample is too small to quote (under 30 matches), so use the counts `hits` and `n` instead.
- `favouriteBaseline` scores the same matches by always taking the pre-match favourite; `random` is one outcome in three.
- `upcoming` entries are locked before kick-off. `pending` entries are current reads that may still change.

## Install

### Claude Desktop

Download `aiball-mcp.mcpb` from the [latest release](https://github.com/aiballfooty/aiball-mcp/releases/latest) and open it.

### Claude Code

```bash
claude mcp add aiball -- npx -y github:aiballfooty/aiball-mcp
```

### Cursor, VS Code and other clients

```json
{
  "mcpServers": {
    "aiball": {
      "command": "npx",
      "args": ["-y", "github:aiballfooty/aiball-mcp"]
    }
  }
}
```

Requires Node.js 18 or later.

## Example questions

- "How did AI Ball's model do on last week's matches?"
- "Show me the Premier League matches the model got wrong."
- "What are the model's probabilities for today's matches, in Malaysia time?"
- "Across the whole record, does the model do better than always taking the favourite?"

## Privacy

The server runs on your machine and sends requests only to `https://aiball.samagent.ai/api/v1`. Requests carry the tool's parameters (a date, a league name, a page number) and a `User-Agent` of `aiball-mcp/<version>`. They do not carry your conversation, your files or any identifier. AI Ball's web server keeps standard access logs. Site privacy policy: https://aiball.samagent.ai/en/privacy

## Development

```bash
npm install
npm test        # starts the server and calls every tool against the live API
```

Set `AIBALL_API_BASE` to point the server at another base URL.

## Licence

MIT. For information only. Not advice. 18+.
