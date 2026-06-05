import { readStdin, getTotalTokens } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs, getAutoCompactWindow } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import type { RenderContext, StdinData } from './types.js';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

export type MainDeps = {
  readStdin: typeof readStdin;
  parseTranscript: typeof parseTranscript;
  countConfigs: typeof countConfigs;
  getAutoCompactWindow: typeof getAutoCompactWindow;
  getGitStatus: typeof getGitStatus;
  getUsage: typeof getUsage;
  loadConfig: typeof loadConfig;
  parseExtraCmdArg: typeof parseExtraCmdArg;
  runExtraCmd: typeof runExtraCmd;
  render: typeof render;
  now: () => number;
  log: (...args: unknown[]) => void;
};

export async function main(overrides: Partial<MainDeps> = {}): Promise<void> {
  const deps: MainDeps = {
    readStdin,
    parseTranscript,
    countConfigs,
    getAutoCompactWindow,
    getGitStatus,
    getUsage,
    loadConfig,
    parseExtraCmdArg,
    runExtraCmd,
    render,
    now: () => Date.now(),
    log: console.log,
    ...overrides,
  };

  try {
    const stdin = await deps.readStdin();

    if (!stdin) {
      deps.log('[claude-hud] Initializing...');
      return;
    }

    applyAutoCompactWindow(stdin, deps.getAutoCompactWindow(stdin.cwd));

    const transcriptPath = stdin.transcript_path ?? '';
    const transcript = await deps.parseTranscript(transcriptPath);

    const { claudeMdCount, rulesCount, mcpCount, hooksCount } = await deps.countConfigs(stdin.cwd);

    const config = await deps.loadConfig();
    const gitStatus = config.gitStatus.enabled
      ? await deps.getGitStatus(stdin.cwd)
      : null;

    // Only fetch usage if enabled in config (replaces env var requirement)
    const usageData = config.display.showUsage !== false
      ? await deps.getUsage({
          ttls: {
            cacheTtlMs: config.usage.cacheTtlSeconds * 1000,
            failureCacheTtlMs: config.usage.failureCacheTtlSeconds * 1000,
          },
        })
      : null;

    const extraCmd = deps.parseExtraCmdArg();
    const extraLabel = extraCmd ? await deps.runExtraCmd(extraCmd) : null;

    const sessionDuration = formatSessionDuration(transcript.sessionStart, deps.now);

    const ctx: RenderContext = {
      stdin,
      transcript,
      claudeMdCount,
      rulesCount,
      mcpCount,
      hooksCount,
      sessionDuration,
      gitStatus,
      usageData,
      config,
      extraLabel,
    };

    deps.render(ctx);
  } catch (error) {
    deps.log('[claude-hud] Error:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Apply Claude Code's auto-compact window setting to the stdin context window.
 *
 * Claude Code reports the model's full context size (e.g. 1M) to the statusline
 * even when a smaller auto-compact window is configured, and its native
 * percentages are computed against that full size. To match what `/context`
 * shows, cap the window to the configured value and recompute the native
 * percentage as the raw token usage against that window (e.g. 76k / 400k = 19%).
 */
export function applyAutoCompactWindow(stdin: StdinData, autoCompactWindow: number | null): void {
  if (!autoCompactWindow || autoCompactWindow <= 0) {
    return;
  }
  if (!stdin.context_window) {
    return;
  }

  const reportedSize = stdin.context_window.context_window_size;
  const effectiveSize = typeof reportedSize === 'number' && reportedSize > 0
    ? Math.min(reportedSize, autoCompactWindow)
    : autoCompactWindow;

  // Nothing to adjust if the model window already matches the auto-compact window.
  if (reportedSize === effectiveSize) {
    return;
  }

  stdin.context_window.context_window_size = effectiveSize;

  // Recompute the native percentage as raw token usage against the capped
  // window so the bar mirrors /context (which shows raw usage, not the
  // estimated auto-compact buffer).
  const rawPercent = Math.min(100, Math.max(0, Math.round((getTotalTokens(stdin) / effectiveSize) * 100)));
  stdin.context_window.used_percentage = rawPercent;
  stdin.context_window.remaining_percentage = 100 - rawPercent;
}

export function formatSessionDuration(sessionStart?: Date, now: () => number = () => Date.now()): string {
  if (!sessionStart) {
    return '';
  }

  const ms = now() - sessionStart.getTime();
  const mins = Math.floor(ms / 60000);

  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

const scriptPath = fileURLToPath(import.meta.url);
const argvPath = process.argv[1];
const isSamePath = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
};
if (argvPath && isSamePath(argvPath, scriptPath)) {
  void main();
}
