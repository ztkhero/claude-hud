export interface ConfigCounts {
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
}
/**
 * Resolve the effective context window from Claude Code's auto-compact window
 * setting. Claude Code reports the model's full context size to the statusline
 * (e.g. 1M) even when a smaller auto-compact window is configured, so the HUD
 * reads the setting directly to match what `/context` shows.
 *
 * Sources, highest precedence first:
 *   1. CLAUDE_CODE_AUTO_COMPACT_WINDOW env var (inherited from Claude Code)
 *   2. settings.json `env.CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `autoCompactWindow`
 *      across project local, project, then user scope
 *
 * Returns null when unset, so callers fall back to stdin's size.
 */
export declare function getAutoCompactWindow(cwd?: string): number | null;
export declare function countConfigs(cwd?: string): Promise<ConfigCounts>;
//# sourceMappingURL=config-reader.d.ts.map