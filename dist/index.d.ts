import { readStdin } from './stdin.js';
import { parseTranscript } from './transcript.js';
import { render } from './render/index.js';
import { countConfigs, getAutoCompactWindow } from './config-reader.js';
import { getGitStatus } from './git.js';
import { getUsage } from './usage-api.js';
import { loadConfig } from './config.js';
import { parseExtraCmdArg, runExtraCmd } from './extra-cmd.js';
import type { StdinData } from './types.js';
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
export declare function main(overrides?: Partial<MainDeps>): Promise<void>;
/**
 * Apply Claude Code's auto-compact window setting to the stdin context window.
 *
 * Claude Code reports the model's full context size (e.g. 1M) to the statusline
 * even when a smaller auto-compact window is configured, and its native
 * percentages are computed against that full size. To match what `/context`
 * shows, cap the window to the configured value and recompute the native
 * percentage as the raw token usage against that window (e.g. 76k / 400k = 19%).
 */
export declare function applyAutoCompactWindow(stdin: StdinData, autoCompactWindow: number | null): void;
export declare function formatSessionDuration(sessionStart?: Date, now?: () => number): string;
//# sourceMappingURL=index.d.ts.map