/**
 * Autocompact buffer percentage.
 *
 * NOTE: This value is applied as a percentage of Claude Code's reported
 * context window size. The `33k/200k` example is just the 200k-window case.
 * It is empirically derived from current Claude Code `/context` output, is
 * not officially documented by Anthropic, and may need adjustment if users
 * report mismatches in future Claude Code versions.
 */
export declare const AUTOCOMPACT_BUFFER_PERCENT = 0.165;
/**
 * Fallback prompt cache TTL (seconds) used when the transcript has not yet
 * revealed which cache lifetime the session writes. Anthropic's default
 * `cache_control` lifetime is 5 minutes; sessions that opt into extended
 * caching write 1-hour blocks instead, which `detectCacheTtlSeconds` picks up.
 */
export declare const DEFAULT_PROMPT_CACHE_TTL_SECONDS = 300;
/** Prompt cache TTLs (seconds) Anthropic reports via `usage.cache_creation` */
export declare const PROMPT_CACHE_TTL_5M_SECONDS = 300;
export declare const PROMPT_CACHE_TTL_1H_SECONDS = 3600;
//# sourceMappingURL=constants.d.ts.map