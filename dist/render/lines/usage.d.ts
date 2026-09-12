import type { RenderContext, SpendData } from '../../types.js';
export declare function renderUsageLine(ctx: RenderContext): string | null;
/** Format extra-usage credit spend as `$57.60/$50.00`, colored by percent used */
export declare function formatSpendPart(spend: SpendData, colors?: RenderContext['config']['colors']): string | null;
/**
 * Resolve which prompt cache TTL the countdown should use.
 *
 * `'auto'` (the default) follows the lifetime detected from the transcript's
 * `cache_creation` tiers, falling back to Anthropic's 5-minute default until a
 * cache write has been observed. An explicit number pins the window instead.
 */
export declare function resolvePromptCacheTtlSeconds(configured: number | 'auto' | undefined, detected: number | undefined): number;
/**
 * Format the prompt-cache countdown as `⧗ 4m`.
 *
 * The window starts when the last API request was *sent* (the transcript's last
 * `user` entry), because that is when the request's cache blocks are written and
 * when an existing cache hit refreshes its TTL. Returns `⧗ --` once it lapses.
 *
 * Minute granularity, rounded down: the statusline only re-renders on activity
 * plus the configured `statusLine.refreshInterval`, so a seconds display would
 * be stale precision. Rounding down keeps the number an "at least" promise.
 */
export declare function formatCacheTimerPart(lastRequestAt: Date | undefined, ttlSeconds: number, colors?: RenderContext['config']['colors'], now?: number): string | null;
//# sourceMappingURL=usage.d.ts.map