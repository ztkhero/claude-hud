import type { ModelUsageLimit, RenderContext, SpendData } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { getProviderLabel } from '../../stdin.js';
import { DEFAULT_PROMPT_CACHE_TTL_SECONDS } from '../../constants.js';
import { critical, warning, dim, cyan, getQuotaColor, quotaBar, RESET } from '../colors.js';

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData?.planName) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  if (ctx.usageData.apiUnavailable) {
    const errorHint = formatUsageError(ctx.usageData.apiError);
    return `${warning(`⚠${errorHint}`, colors)}`;
  }

  const spendPart = display?.showSpend !== false && ctx.usageData.spend
    ? formatSpendPart(ctx.usageData.spend, colors)
    : null;
  const cachePart = display?.showCacheTimer !== false
    ? formatCacheTimerPart(
        ctx.transcript?.lastRequestAt,
        resolvePromptCacheTtlSeconds(display?.promptCacheTtlSeconds, ctx.transcript?.cacheTtlSeconds),
        colors
      )
    : null;
  const tailParts = [cachePart, spendPart].filter((part): part is string => part !== null);

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    const limitLine = `${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
    return [limitLine, ...tailParts].join(' | ');
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;
  const modelLimits = (display?.showModelUsage !== false && ctx.usageData.modelLimits)
    ? ctx.usageData.modelLimits.filter((limit) => limit.utilization !== null)
    : [];

  const maxModelUsage = modelLimits.reduce((max, limit) => Math.max(max, limit.utilization ?? 0), 0);
  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0, maxModelUsage);
  if (effectiveUsage < threshold) {
    return null;
  }

  const fiveHourDisplay = formatUsagePercent(ctx.usageData.fiveHour, colors);
  const fiveHourReset = formatResetTime(ctx.usageData.fiveHourResetAt);

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const fiveHourPart = usageBarEnabled
    ? (fiveHourReset
        ? `${quotaBar(fiveHour ?? 0, 5, colors)} ${fiveHourDisplay} (${fiveHourReset})`
        : `${quotaBar(fiveHour ?? 0, 5, colors)} ${fiveHourDisplay}`)
    : (fiveHourReset
        ? `5h: ${fiveHourDisplay} (${fiveHourReset})`
        : `5h: ${fiveHourDisplay}`);

  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const syncingSuffix = ctx.usageData.apiError === 'rate-limited'
    ? ` ${dim('(syncing...)')}`
    : '';
  const parts = [fiveHourPart];
  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayDisplay = formatUsagePercent(sevenDay, colors);
    const sevenDayReset = formatResetTime(ctx.usageData.sevenDayResetAt);
    const sevenDayPart = usageBarEnabled
      ? (sevenDayReset
          ? `${quotaBar(sevenDay, 5, colors)} ${sevenDayDisplay} (${sevenDayReset})`
          : `${quotaBar(sevenDay, 5, colors)} ${sevenDayDisplay}`)
      : (sevenDayReset
          ? `7d: ${sevenDayDisplay} (${sevenDayReset})`
          : `7d: ${sevenDayDisplay}`);
    parts.push(sevenDayPart);
  }

  for (const limit of modelLimits) {
    parts.push(formatModelLimitPart(limit, usageBarEnabled, colors));
  }

  parts.push(...tailParts);

  return `${parts.join(' | ')}${syncingSuffix}`;
}

/** Format extra-usage credit spend as `$57.60/$50.00`, colored by percent used */
export function formatSpendPart(
  spend: SpendData,
  colors?: RenderContext['config']['colors']
): string | null {
  const used = formatMoney(spend.usedMinor, spend.currency, spend.exponent);
  if (used === null) return null;

  const color = getQuotaColor(spend.percent ?? 0, colors);
  const limit = spend.limitMinor !== null
    ? formatMoney(spend.limitMinor, spend.currency, spend.exponent)
    : null;

  return limit !== null
    ? `${color}${used}${RESET}${dim(`/${limit}`)}`
    : `${color}${used}${RESET}`;
}

function formatMoney(amountMinor: number, currency: string, exponent: number): string | null {
  const amount = amountMinor / Math.pow(10, exponent);
  if (!Number.isFinite(amount)) return null;
  try {
    // narrowSymbol renders AUD/CAD/etc. as plain "$" rather than "A$"
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(exponent)}`;
  }
}

/**
 * Resolve which prompt cache TTL the countdown should use.
 *
 * `'auto'` (the default) follows the lifetime detected from the transcript's
 * `cache_creation` tiers, falling back to Anthropic's 5-minute default until a
 * cache write has been observed. An explicit number pins the window instead.
 */
export function resolvePromptCacheTtlSeconds(
  configured: number | 'auto' | undefined,
  detected: number | undefined
): number {
  if (typeof configured === 'number' && configured > 0) {
    return configured;
  }
  return detected ?? DEFAULT_PROMPT_CACHE_TTL_SECONDS;
}

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
export function formatCacheTimerPart(
  lastRequestAt: Date | undefined,
  ttlSeconds: number,
  colors?: RenderContext['config']['colors'],
  now: number = Date.now()
): string | null {
  if (!lastRequestAt) return null;

  const sentAt = lastRequestAt.getTime();
  if (!Number.isFinite(sentAt)) return null;

  const ttlMs = Math.max(0, ttlSeconds) * 1000;
  const remainingMs = sentAt + ttlMs - now;
  if (remainingMs <= 0) {
    return dim('⧗ --');
  }

  const label = formatRemainingWindow(remainingMs);

  // Last quarter of the window: the next request is about to pay a full cache write
  return remainingMs <= ttlMs / 4
    ? `${dim('⧗')} ${warning(label, colors)}`
    : `${dim('⧗')} ${cyan(label)}`;
}

/** Remaining cache window as `<1m`, `12m`, `1h`, or `1h 12m` (rounded down) */
function formatRemainingWindow(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;

  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

function formatModelLimitPart(
  limit: ModelUsageLimit,
  usageBarEnabled: boolean,
  colors?: RenderContext['config']['colors']
): string {
  // No reset countdown: model limits share the weekly window, so it would duplicate the 7d reset
  const percentDisplay = formatUsagePercent(limit.utilization, colors);
  return usageBarEnabled
    ? `${limit.model} ${quotaBar(limit.utilization ?? 0, 5, colors)} ${percentDisplay}`
    : `${limit.model}: ${percentDisplay}`;
}

function formatUsagePercent(percent: number | null, colors?: RenderContext['config']['colors']): string {
  if (percent === null) {
    return dim('--');
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageError(error?: string): string {
  if (!error) return '';
  if (error === 'rate-limited') return ' (syncing...)';
  if (error.startsWith('http-')) return ` (${error.slice(5)})`;
  return ` (${error})`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return '';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
