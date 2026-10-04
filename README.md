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
| `list_matches` | One calendar day: `match_id`, kick-off time, league, teams and status (`upcoming`, `pending` or `finished`) |
| `get_match_analysis` | One match: home / draw / away probabilities recorded before kick-off, the most likely outcome, confidence, when the read was captured, and once played the score and whether it came in |
| `get_open_record` | The whole record, or one week with `week_start`: matches counted, how many went the model's way, two baselines on the same matches, and the count by confidence band |

Every tool is read-only (`readOnlyHint: true`). Names are available in English (`lang: "en"`) and Malay (`lang: "ms"`). Responses are built from a fixed list of fields; nothing from the upstream API is passed through as-is.

### Reading the numbers

- `models.balanced` holds fractions for `home`, `draw` and `away` that sum to 1. This version returns the balanced model; `models_available` lists what is included.
- `result.hit` is `true` when the model's most likely outcome happened.
- `hit_rate` is a percentage. `null` means the sample is under `min_band_sample`, so use the counts `hits` and `n` instead.
- `favourite_baseline` scores the same matches by always taking the pre-match favourite; `random_baseline` is one outcome in three.
- `upcoming` matches are locked before kick-off. `pending` matches carry a current read that may still change.

The server caches each upstream response for five minutes and spaces its requests, so repeated questions do not hit AI Ball's API again.

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
- "Which of last week's matches did the model get wrong?"
- "What are the model's probabilities for today's matches, in Malaysia time?"
- "Across the whole record, does the model do better than always taking the favourite?"

## Privacy

The server runs on your machine and sends requests only to `https://aiball.samagent.ai/api/v1`. Requests carry the tool's parameters (a date, a time zone, a language) and a `User-Agent` of `aiball-mcp/<version>`. They do not carry your conversation, your files or any identifier. AI Ball's web server keeps standard access logs. Site privacy policy: https://aiball.samagent.ai/en/privacy

## Development

```bash
npm install
npm test        # starts the server and calls every tool against the live API
```

Set `AIBALL_API_BASE` to point the server at another base URL.

## Licence

MIT. For information only. Not advice. 18+.
