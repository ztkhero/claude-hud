import type { ModelUsageLimit, RenderContext, SpendData } from '../../types.js';
import { isLimitReached } from '../../types.js';
import { getProviderLabel } from '../../stdin.js';
import { critical, warning, dim, getQuotaColor, quotaBar, RESET } from '../colors.js';

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

  if (isLimitReached(ctx.usageData)) {
    const resetTime = ctx.usageData.fiveHour === 100
      ? formatResetTime(ctx.usageData.fiveHourResetAt)
      : formatResetTime(ctx.usageData.sevenDayResetAt);
    const limitLine = `${critical(`⚠ Limit reached${resetTime ? ` (resets ${resetTime})` : ''}`, colors)}`;
    return spendPart ? `${limitLine} | ${spendPart}` : limitLine;
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

  if (spendPart) {
    parts.push(spendPart);
  }

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
