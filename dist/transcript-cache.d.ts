import * as fs from 'node:fs';
import type { ToolEntry, AgentEntry, TodoItem } from './types.js';
/** Accumulator threaded through a parse, persisted between renders */
export interface ParseState {
    toolMap: Map<string, ToolEntry>;
    agentMap: Map<string, AgentEntry>;
    todos: TodoItem[];
    taskIdToIndex: Map<string, number>;
    slug?: string;
    customTitle?: string;
    sessionStart?: Date;
    lastRequestAt?: Date;
    cacheTtlSeconds?: number;
}
export declare function createParseState(): ParseState;
/**
 * Drop the oldest entries once a map outgrows its cap.
 *
 * Renders only ever show the last 20 tools / 10 agents, and a `tool_result`
 * always follows its `tool_use` within a handful of entries, so evicting in
 * insertion order cannot change the rendered output — it just stops a
 * days-long session from persisting tens of thousands of dead entries.
 */
export declare function trimParseState(state: ParseState): void;
export declare function shouldCache(size: number): boolean;
/**
 * Byte offset just past the final complete line.
 *
 * Claude Code appends whole lines, so the file almost always ends in a newline
 * and this is just `size`. When a render lands mid-write, back up to the last
 * terminator so the partial line is re-read (whole) on the next render.
 */
export declare function findLineBoundary(handle: fs.promises.FileHandle, size: number): Promise<number | null>;
/**
 * Load a usable cache entry, or null to force a full parse.
 *
 * Rejects anything that suggests the file is not the same append-only stream
 * the entry was written from: a shrunken file, a rewound mtime, or changed
 * bytes anywhere in the range the entry already consumed.
 */
export declare function readCache(transcriptPath: string, stat: fs.Stats, handle: fs.promises.FileHandle): Promise<{
    state: ParseState;
    offset: number;
} | null>;
/** Persist the accumulator. Best-effort: a failed write just costs a full parse next time. */
export declare function writeCache(transcriptPath: string, state: ParseState, offset: number, stat: fs.Stats, handle: fs.promises.FileHandle, prune: boolean): Promise<void>;
//# sourceMappingURL=transcript-cache.d.ts.map