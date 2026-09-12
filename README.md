# Claude HUD

A Claude Code plugin that shows what's happening — context usage, active tools, running agents, and todo progress. Always visible below your input.

[![License](https://img.shields.io/github/license/jarrodwatts/claude-hud?v=2)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jarrodwatts/claude-hud)](https://github.com/jarrodwatts/claude-hud/stargazers)

![Claude HUD in action](claude-hud-preview-5-2.png)

## Install

Inside a Claude Code instance, run the following commands:

**Step 1: Add the marketplace**
```
/plugin marketplace add jarrodwatts/claude-hud
```

**Step 2: Install the plugin**

<details>
<summary><strong>⚠️ Linux users: Click here first</strong></summary>

On Linux, `/tmp` is often a separate filesystem (tmpfs), which causes plugin installation to fail with:
```
EXDEV: cross-device link not permitted
```

**Fix**: Set TMPDIR before installing:
```bash
mkdir -p ~/.cache/tmp && TMPDIR=~/.cache/tmp claude
```

Then run the install command below in that session. This is a [Claude Code platform limitation](https://github.com/anthropics/claude-code/issues/14799).

</details>

```
/plugin install claude-hud
```

**Step 3: Configure the statusline**
```
/claude-hud:setup
```

Done! The HUD appears immediately — no restart needed.

---

## What is Claude HUD?

Claude HUD gives you better insights into what's happening in your Claude Code session.

| What You See | Why It Matters |
|--------------|----------------|
| **Project path** | Know which project you're in (configurable 1-3 directory levels) |
| **Context health** | Know exactly how full your context window is before it's too late |
| **Tool activity** | Watch Claude read, edit, and search files as it happens |
| **Agent tracking** | See which subagents are running and what they're doing |
| **Todo progress** | Track task completion in real-time |

## What You See

### Default (2 lines)
```
[Opus | Max] │ my-project git:(main*)
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h)
```
- **Line 1** — Model, plan name (or `Bedrock`), project path, git branch
- **Line 2** — Context bar (green → yellow → red) and usage rate limits

### Optional lines (enable via `/claude-hud:configure`)
```
◐ Edit: auth.ts | ✓ Read ×3 | ✓ Grep ×2        ← Tools activity
◐ explore [haiku]: Finding auth code (2m 15s)    ← Agent status
▸ Fix authentication bug (2/5)                   ← Todo progress
```

---

## How It Works

Claude HUD uses Claude Code's native **statusline API** — no separate window, no tmux required, works in any terminal.

```
Claude Code → stdin JSON → claude-hud → stdout → displayed in your terminal
           ↘ transcript JSONL (tools, agents, todos)
```

**Key features:**
- Native token data from Claude Code (not estimated)
- Scales with Claude Code's reported context window size, including newer 1M-context sessions
- Respects `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (env var or `settings.json`), so the context bar shows raw usage against your capped window and matches `/context` (e.g. 76k / 400k = 19%)
- Parses the transcript for tool/agent activity
- Updates every ~300ms

---

## Configuration

Customize your HUD anytime:

```
/claude-hud:configure
```

The guided flow handles layout and display toggles. Advanced overrides such as
custom colors and thresholds are preserved there, but you set them by editing the config file directly:

- **First time setup**: Choose a preset (Full/Essential/Minimal), then fine-tune individual elements
- **Customize anytime**: Toggle items on/off, adjust git display style, switch layouts
- **Preview before saving**: See exactly how your HUD will look before committing changes

### Presets

| Preset | What's Shown |
|--------|--------------|
| **Full** | Everything enabled — tools, agents, todos, git, usage, duration |
| **Essential** | Activity lines + git status, minimal info clutter |
| **Minimal** | Core only — just model name and context bar |

After choosing a preset, you can turn individual elements on or off.

### Manual Configuration

Edit `~/.claude/plugins/claude-hud/config.json` directly for advanced settings such as `colors.*`,
`pathLevels`, and threshold overrides. Running `/claude-hud:configure` preserves those manual settings.

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `pathLevels` | 1-3 | 1 | Directory levels to show in project path |
| `elementOrder` | string[] | `["project","context","usage","environment","tools","agents","todos"]` | Expanded-mode element order. Omit entries to hide them in expanded mode. |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` | `percent` | Context display format (`45%`, `45k/200k`, or `55%` remaining) |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.showDuration` | boolean | false | Show session duration `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show output token speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show usage limits (Pro/Max/Team only) |
| `display.showModelUsage` | boolean | true | Show model-scoped weekly limits (e.g. Fable) when reported by the API |
| `display.showCacheTimer` | boolean | true | Show the prompt-cache countdown `⧗ 41m` |
| `display.promptCacheTtlSeconds` | `auto` \| number | `auto` | Prompt cache TTL the countdown is based on. `auto` detects 5-minute vs 1-hour caching from the transcript; a number pins it |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show session slug or custom title from `/rename` |
| `usage.cacheTtlSeconds` | number | 60 | How long (seconds) to cache a successful usage API response |
| `usage.failureCacheTtlSeconds` | number | 15 | How long (seconds) to cache a failed usage API response before retrying |
| `colors.context` | color name | `green` | Base color for the context bar and context percentage |
| `colors.usage` | color name | `brightBlue` | Base color for usage bars and percentages below warning thresholds |
| `colors.warning` | color name | `yellow` | Warning color for context thresholds and usage warning text |
| `colors.usageWarning` | color name | `brightMagenta` | Warning color for usage bars and percentages near their threshold |
| `colors.critical` | color name | `red` | Critical color for limit-reached states and critical thresholds |

Supported color names: `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`.

### Usage Limits (Pro/Max/Team)

Usage display is **enabled by default** for Claude Pro, Max, and Team subscribers. It shows your rate limit consumption on line 2 alongside the context bar.

The 7-day percentage appears when above the `display.sevenDayThreshold` (default 80%):

```
Context █████░░░░░ 45% │ Usage ██░░░░░░░░ 25% (1h 30m / 5h) | ██████████ 85% (2d / 7d)
```

When your plan has a model-specific weekly limit (e.g. Fable), it appears labeled with the model name:

```
Usage ██░░░░░░░░ 25% (1h 30m / 5h) | Fable ██░░░░░░░░ 18%
```

To disable, set `display.showUsage` to `false` (all usage) or `display.showModelUsage` to `false` (model-scoped limits only).

### Transcript Parsing

The statusline re-runs as a fresh process on every render, so parsing the session transcript from byte 0 each time dominates its cost — a 95MB session measures ~186ms per render, and that cost grows for as long as the session lives.

Transcripts are append-only, so renders resume from where the previous one stopped: the parsed accumulator and its byte offset are cached under `~/.claude/plugins/claude-hud/transcript-cache/`, and only the newly appended lines are folded in. Measured on a real 95MB transcript, this takes a render's parse from **174ms to 1.8ms**.

The cache is an optimization, never a source of truth. It is skipped entirely for transcripts under 1MB (where a full parse is already ~ms), and any sign that the file is not the same append-only stream — a shrunken file, a rewound mtime, or a fingerprint mismatch across four sampled windows of the already-consumed range — falls back to a full parse. So does an unreadable or malformed cache entry. Set `CLAUDE_HUD_TRANSCRIPT_CACHE=0` to disable it.

### Prompt Cache Timer

A countdown showing how much of the prompt cache window is left before the conversation's cached prefix expires:

```
Usage ██░░░░░░░░ 25% (1h 30m / 5h) | Fable █████ 94% | ⧗ 41m | $0.00
```

The window starts when the last API request was **sent** — the transcript's most recent `user` entry (your prompt, or a tool result) — because that is when the request's cache blocks are written and when an existing cache hit refreshes its TTL. Subagent (sidechain) traffic is ignored, since it uses its own cache prefix.

The remaining time is shown at minute granularity, rounded down, so the number reads as an "at least" promise. Seconds would be stale precision: the statusline only re-renders on activity plus whatever `statusLine.refreshInterval` is set to in `settings.json` (Claude Code does no periodic refresh by default). The timer turns yellow in the final quarter of the window and shows `⧗ --` once it lapses, meaning the next request pays for a full cache write instead of a cheap cache read.

The window length is detected automatically from `usage.cache_creation` in the transcript, which reports whether the session writes 5-minute or 1-hour cache blocks. Until the first cache write is seen, it falls back to Anthropic's 5-minute default. To pin it instead, set `display.promptCacheTtlSeconds` to a number of seconds (e.g. `3600`). To hide the timer, set `display.showCacheTimer` to `false`.

**Requirements:**
- Claude Pro, Max, or Team subscription (not available for API users)
- OAuth credentials from Claude Code (created automatically when you log in)

**Troubleshooting:** If usage doesn't appear:
- Ensure you're logged in with a Pro/Max/Team account (not API key)
- Check `display.showUsage` is not set to `false` in config
- API users see no usage display (they have pay-per-token, not rate limits)
- AWS Bedrock models display `Bedrock` and hide usage limits (usage is managed in AWS)
- Non-default `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_BASE_URL` settings skip usage display, because the Anthropic OAuth usage API may not apply
- If you are behind a proxy, set `HTTPS_PROXY` (or `HTTP_PROXY`/`ALL_PROXY`) and optional `NO_PROXY`
- For high-latency environments, increase usage API timeout with `CLAUDE_HUD_USAGE_TIMEOUT_MS` (milliseconds)

### Example Configuration

```json
{
  "lineLayout": "expanded",
  "pathLevels": 2,
  "elementOrder": ["project", "tools", "context", "usage", "environment", "agents", "todos"],
  "gitStatus": {
    "enabled": true,
    "showDirty": true,
    "showAheadBehind": true,
    "showFileStats": true
  },
  "display": {
    "showTools": true,
    "showAgents": true,
    "showTodos": true,
    "showConfigCounts": true,
    "showDuration": true
  },
  "colors": {
    "context": "cyan",
    "usage": "cyan",
    "warning": "yellow",
    "usageWarning": "magenta",
    "critical": "red"
  },
  "usage": {
    "cacheTtlSeconds": 120,
    "failureCacheTtlSeconds": 30
  }
}
```

### Display Examples

**1 level (default):** `[Opus] │ my-project git:(main)`

**2 levels:** `[Opus] │ apps/my-project git:(main)`

**3 levels:** `[Opus] │ dev/apps/my-project git:(main)`

**With dirty indicator:** `[Opus] │ my-project git:(main*)`

**With ahead/behind:** `[Opus] │ my-project git:(main ↑2 ↓1)`

**With file stats:** `[Opus] │ my-project git:(main* !3 +1 ?2)`
- `!` = modified files, `+` = added/staged, `✘` = deleted, `?` = untracked
- Counts of 0 are omitted for cleaner display

### Troubleshooting

**Config not applying?**
- Check for JSON syntax errors: invalid JSON silently falls back to defaults
- Ensure valid values: `pathLevels` must be 1, 2, or 3; `lineLayout` must be `expanded` or `compact`
- Delete config and run `/claude-hud:configure` to regenerate

**Git status missing?**
- Verify you're in a git repository
- Check `gitStatus.enabled` is not `false` in config

**Tool/agent/todo lines missing?**
- These are hidden by default — enable with `showTools`, `showAgents`, `showTodos` in config
- They also only appear when there's activity to show

---

## Requirements

- Claude Code v1.0.80+
- Node.js 18+ or Bun

---

## Development

```bash
git clone https://github.com/jarrodwatts/claude-hud
cd claude-hud
npm ci && npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=jarrodwatts/claude-hud&type=Date)](https://star-history.com/#jarrodwatts/claude-hud&Date)
