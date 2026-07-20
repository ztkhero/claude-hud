import type { RenderContext, SpendData } from '../../types.js';
export declare function renderUsageLine(ctx: RenderContext): string | null;
/** Format extra-usage credit spend as `$57.60/$50.00`, colored by percent used */
export declare function formatSpendPart(spend: SpendData, colors?: RenderContext['config']['colors']): string | null;
//# sourceMappingURL=usage.d.ts.map