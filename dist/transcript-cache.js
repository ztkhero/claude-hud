import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { getHudPluginDir } from './claude-config-dir.js';
/**
 * On-disk cache backing incremental transcript parsing.
 *
 * The statusline re-runs from scratch on every render, so parsing a multi-MB
 * JSONL transcript from byte 0 each time dominates its cost (a 95MB session
 * measured ~186ms per render). Transcripts are append-only, so a render can
 * instead resume from the byte offset the previous render stopped at and fold
 * only the newly appended lines into the cached accumulator.
 *
 * Every guard below falls back to a full parse rather than risking stale
 * output: the cache is an optimization, never a source of truth.
 */
/** Bump when the persisted shape changes so old entries are ignored, not misread */
const CACHE_VERSION = 2;
/** Below this the full parse is already ~ms, so skip the cache entirely */
const MIN_CACHED_SIZE = 1_000_000;
/** Size of each sampled window used to detect an in-place rewrite */
const FINGERPRINT_WINDOW_BYTES = 256;
/** Windows sampled across the consumed range (head, two interior points, tail) */
const FINGERPRINT_WINDOWS = 4;
/** How far back to hunt for a line terminator when a file ends mid-write */
const MAX_NEWLINE_SCAN = 8 * 1024 * 1024;
/** Keep the accumulator bounded; renders only ever surface the last 20/10 */
const MAX_CACHED_TOOLS = 500;
const MAX_CACHED_AGENTS = 200;
/** Prune the cache directory back to this many files once it exceeds the cap */
const MAX_CACHE_FILES = 200;
const PRUNE_TARGET_FILES = 150;
export function createParseState() {
    return {
        toolMap: new Map(),
        agentMap: new Map(),
        todos: [],
        taskIdToIndex: new Map(),
    };
}
/**
 * Drop the oldest entries once a map outgrows its cap.
 *
 * Renders only ever show the last 20 tools / 10 agents, and a `tool_result`
 * always follows its `tool_use` within a handful of entries, so evicting in
 * insertion order cannot change the rendered output — it just stops a
 * days-long session from persisting tens of thousands of dead entries.
 */
export function trimParseState(state) {
    evictOldest(state.toolMap, MAX_CACHED_TOOLS);
    evictOldest(state.agentMap, MAX_CACHED_AGENTS);
}
function evictOldest(map, cap) {
    if (map.size <= cap)
        return;
    for (const key of map.keys()) {
        if (map.size <= cap)
            break;
        map.delete(key);
    }
}
function isCacheDisabled() {
    const flag = process.env.CLAUDE_HUD_TRANSCRIPT_CACHE?.trim();
    return flag === '0' || flag === 'false';
}
export function shouldCache(size) {
    return !isCacheDisabled() && size >= MIN_CACHED_SIZE;
}
function getCacheDir() {
    return path.join(getHudPluginDir(os.homedir()), 'transcript-cache');
}
function getCachePath(transcriptPath) {
    const key = createHash('sha256').update(transcriptPath).digest('hex').slice(0, 32);
    return path.join(getCacheDir(), `${key}.json`);
}
/**
 * Fingerprint the already-consumed range `[0, offset)` to detect a rewrite.
 *
 * Appending never changes these bytes, so a mismatch means the file is not the
 * same stream the cache was built from. Windows are sampled at the head, two
 * interior points and the tail rather than hashing the whole range, which would
 * cost exactly what the cache exists to avoid. `offset` is folded in so a
 * same-content range at a different length can't collide.
 */
async function fingerprint(handle, offset) {
    if (offset <= 0)
        return '';
    const hash = createHash('sha256').update(String(offset));
    const window = Math.min(FINGERPRINT_WINDOW_BYTES, offset);
    const positions = new Set();
    for (let i = 0; i < FINGERPRINT_WINDOWS; i++) {
        // Spread the windows over the range, with the last one flush against offset
        const start = Math.min(Math.floor((offset * i) / FINGERPRINT_WINDOWS), offset - window);
        positions.add(Math.max(0, start));
    }
    for (const start of [...positions].sort((a, b) => a - b)) {
        const buffer = Buffer.allocUnsafe(window);
        await handle.read(buffer, 0, window, start);
        hash.update(buffer);
    }
    return hash.digest('hex').slice(0, 16);
}
/**
 * Byte offset just past the final complete line.
 *
 * Claude Code appends whole lines, so the file almost always ends in a newline
 * and this is just `size`. When a render lands mid-write, back up to the last
 * terminator so the partial line is re-read (whole) on the next render.
 */
export async function findLineBoundary(handle, size) {
    if (size === 0)
        return 0;
    const last = Buffer.allocUnsafe(1);
    await handle.read(last, 0, 1, size - 1);
    if (last[0] === 0x0a)
        return size;
    const chunkSize = 256 * 1024;
    let end = size;
    const floor = Math.max(0, size - MAX_NEWLINE_SCAN);
    while (end > floor) {
        const start = Math.max(floor, end - chunkSize);
        const buffer = Buffer.allocUnsafe(end - start);
        await handle.read(buffer, 0, buffer.length, start);
        const index = buffer.lastIndexOf(0x0a);
        if (index !== -1)
            return start + index + 1;
        end = start;
    }
    // A single line longer than the scan window: let the caller parse in full
    return null;
}
/**
 * Load a usable cache entry, or null to force a full parse.
 *
 * Rejects anything that suggests the file is not the same append-only stream
 * the entry was written from: a shrunken file, a rewound mtime, or changed
 * bytes anywhere in the range the entry already consumed.
 */
export async function readCache(transcriptPath, stat, handle) {
    if (!shouldCache(stat.size))
        return null;
    try {
        const raw = await fs.promises.readFile(getCachePath(transcriptPath), 'utf-8');
        const entry = JSON.parse(raw);
        if (entry.version !== CACHE_VERSION)
            return null;
        if (!Number.isInteger(entry.offset) || entry.offset < 0)
            return null;
        if (stat.size < entry.offset)
            return null; // truncated or replaced
        if (stat.mtimeMs < entry.mtimeMs)
            return null; // rewound behind us
        if (await fingerprint(handle, entry.offset) !== entry.fingerprint)
            return null;
        return { state: deserialize(entry), offset: entry.offset };
    }
    catch {
        return null;
    }
}
/** Persist the accumulator. Best-effort: a failed write just costs a full parse next time. */
export async function writeCache(transcriptPath, state, offset, stat, handle, prune) {
    if (!shouldCache(stat.size))
        return;
    try {
        const cacheDir = getCacheDir();
        await fs.promises.mkdir(cacheDir, { recursive: true });
        const entry = {
            version: CACHE_VERSION,
            offset,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            fingerprint: await fingerprint(handle, offset),
            tools: Array.from(state.toolMap.values()).map(serializeTool),
            agents: Array.from(state.agentMap.values()).map(serializeAgent),
            todos: state.todos,
            taskIdToIndex: Array.from(state.taskIdToIndex.entries()),
            slug: state.slug,
            customTitle: state.customTitle,
            sessionStart: state.sessionStart?.toISOString(),
            lastRequestAt: state.lastRequestAt?.toISOString(),
            cacheTtlSeconds: state.cacheTtlSeconds,
        };
        // Atomic swap so a concurrent render never reads a half-written entry
        const target = getCachePath(transcriptPath);
        const temp = `${target}.${process.pid}.tmp`;
        await fs.promises.writeFile(temp, JSON.stringify(entry), 'utf-8');
        await fs.promises.rename(temp, target);
        if (prune)
            await pruneCacheDir(cacheDir);
    }
    catch {
        // Cache writes are optional
    }
}
/** Keep the cache directory from growing without bound across many sessions */
async function pruneCacheDir(cacheDir) {
    try {
        const names = (await fs.promises.readdir(cacheDir)).filter(n => n.endsWith('.json'));
        if (names.length <= MAX_CACHE_FILES)
            return;
        const stats = await Promise.all(names.map(async (name) => {
            const full = path.join(cacheDir, name);
            try {
                return { full, mtimeMs: (await fs.promises.stat(full)).mtimeMs };
            }
            catch {
                return { full, mtimeMs: 0 };
            }
        }));
        stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
        await Promise.all(stats.slice(0, stats.length - PRUNE_TARGET_FILES)
            .map(({ full }) => fs.promises.rm(full, { force: true })));
    }
    catch {
        // Pruning is opportunistic
    }
}
function serializeTool(tool) {
    return { ...tool, startTime: tool.startTime.toISOString(), endTime: tool.endTime?.toISOString() };
}
function serializeAgent(agent) {
    return { ...agent, startTime: agent.startTime.toISOString(), endTime: agent.endTime?.toISOString() };
}
function deserialize(entry) {
    const state = createParseState();
    for (const tool of entry.tools ?? []) {
        state.toolMap.set(tool.id, {
            ...tool,
            startTime: new Date(tool.startTime),
            endTime: tool.endTime ? new Date(tool.endTime) : undefined,
        });
    }
    for (const agent of entry.agents ?? []) {
        state.agentMap.set(agent.id, {
            ...agent,
            startTime: new Date(agent.startTime),
            endTime: agent.endTime ? new Date(agent.endTime) : undefined,
        });
    }
    state.todos = Array.isArray(entry.todos) ? entry.todos : [];
    state.taskIdToIndex = new Map(entry.taskIdToIndex ?? []);
    state.slug = entry.slug;
    state.customTitle = entry.customTitle;
    state.sessionStart = entry.sessionStart ? new Date(entry.sessionStart) : undefined;
    state.lastRequestAt = entry.lastRequestAt ? new Date(entry.lastRequestAt) : undefined;
    state.cacheTtlSeconds = entry.cacheTtlSeconds;
    return state;
}
//# sourceMappingURL=transcript-cache.js.map