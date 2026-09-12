import * as fs from 'fs';
import * as readline from 'readline';
import { PROMPT_CACHE_TTL_1H_SECONDS, PROMPT_CACHE_TTL_5M_SECONDS } from './constants.js';
import { createParseState, findLineBoundary, readCache, shouldCache, trimParseState, writeCache, } from './transcript-cache.js';
export async function parseTranscript(transcriptPath) {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
        return { tools: [], agents: [], todos: [] };
    }
    try {
        return await parseWithCache(transcriptPath);
    }
    catch {
        // Any cache trouble degrades to the plain full parse, never to wrong output
        try {
            const state = createParseState();
            await applyStream(state, transcriptPath);
            return finalize(state);
        }
        catch {
            return { tools: [], agents: [], todos: [] };
        }
    }
}
/**
 * Parse the transcript, resuming from the previous render's byte offset.
 *
 * Transcripts are append-only, so a render normally only has to fold the few
 * lines added since it last ran. A cache miss (first sight of the file, a
 * rewrite, a small file) falls back to streaming the whole thing and seeds the
 * cache for next time.
 */
async function parseWithCache(transcriptPath) {
    const handle = await fs.promises.open(transcriptPath, 'r');
    try {
        const stat = await handle.stat();
        const cached = shouldCache(stat.size)
            ? await readCache(transcriptPath, stat, handle)
            : null;
        if (cached) {
            const boundary = await findLineBoundary(handle, stat.size);
            if (boundary !== null && boundary >= cached.offset) {
                if (boundary > cached.offset) {
                    await applyChunk(cached.state, handle, cached.offset, boundary);
                }
                trimParseState(cached.state);
                await writeCache(transcriptPath, cached.state, boundary, stat, handle, false);
                return finalize(cached.state);
            }
        }
        const state = createParseState();
        await applyStream(state, transcriptPath);
        trimParseState(state);
        const boundary = await findLineBoundary(handle, stat.size);
        if (boundary !== null) {
            await writeCache(transcriptPath, state, boundary, stat, handle, true);
        }
        return finalize(state);
    }
    finally {
        await handle.close();
    }
}
/** Stream the whole file, folding every line into `state` */
async function applyStream(state, transcriptPath) {
    const fileStream = fs.createReadStream(transcriptPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    try {
        for await (const line of rl) {
            applyLine(state, line);
        }
    }
    finally {
        rl.close();
        fileStream.destroy();
    }
}
/** Fold the byte range `[start, end)` — always whole lines — into `state` */
async function applyChunk(state, handle, start, end) {
    const buffer = Buffer.allocUnsafe(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    for (const line of buffer.toString('utf-8').split('\n')) {
        applyLine(state, line);
    }
}
function applyLine(state, line) {
    if (!line.trim())
        return;
    try {
        const entry = JSON.parse(line);
        // A `user` entry (prompt or tool_result) is written right before the API
        // request that carries it, so its timestamp is when that request was sent
        // — which is when the prompt cache for this conversation was last touched.
        // Sidechain entries belong to subagents and use their own cache prefix.
        if (entry.type === 'user' && !entry.isSidechain && entry.timestamp) {
            const ts = new Date(entry.timestamp);
            if (!Number.isNaN(ts.getTime())) {
                state.lastRequestAt = ts;
            }
        }
        state.cacheTtlSeconds = detectCacheTtlSeconds(entry) ?? state.cacheTtlSeconds;
        if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
            state.customTitle = entry.customTitle;
        }
        else if (typeof entry.slug === 'string') {
            state.slug = entry.slug;
        }
        processEntry(entry, state);
    }
    catch {
        // Skip malformed lines
    }
}
function finalize(state) {
    return {
        tools: Array.from(state.toolMap.values()).slice(-20),
        agents: Array.from(state.agentMap.values()).slice(-10),
        todos: state.todos,
        sessionStart: state.sessionStart,
        sessionName: state.customTitle ?? state.slug,
        lastRequestAt: state.lastRequestAt,
        cacheTtlSeconds: state.cacheTtlSeconds,
    };
}
/**
 * Detect which prompt cache lifetime this session writes.
 *
 * Anthropic reports the tokens written to each cache tier in
 * `usage.cache_creation`. Only the request that *writes* a cache block reports
 * non-zero counts — later cache-read-only requests report zeros — so callers
 * keep the most recent non-zero observation rather than resetting on zeros.
 * Sidechain (subagent) traffic is ignored so it can't mislabel the main
 * conversation's cache.
 */
function detectCacheTtlSeconds(entry) {
    if (entry.isSidechain)
        return undefined;
    const created = entry.message?.usage?.cache_creation;
    if (!created)
        return undefined;
    const oneHour = created.ephemeral_1h_input_tokens ?? 0;
    const fiveMin = created.ephemeral_5m_input_tokens ?? 0;
    if (oneHour > 0 && oneHour >= fiveMin)
        return PROMPT_CACHE_TTL_1H_SECONDS;
    if (fiveMin > 0)
        return PROMPT_CACHE_TTL_5M_SECONDS;
    return undefined;
}
function processEntry(entry, state) {
    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    if (!state.sessionStart && entry.timestamp) {
        state.sessionStart = timestamp;
    }
    const content = entry.message?.content;
    if (!content || !Array.isArray(content))
        return;
    for (const block of content) {
        if (block.type === 'tool_use' && block.id && block.name) {
            const toolEntry = {
                id: block.id,
                name: block.name,
                target: extractTarget(block.name, block.input),
                status: 'running',
                startTime: timestamp,
            };
            if (block.name === 'Task') {
                const input = block.input;
                const agentEntry = {
                    id: block.id,
                    type: input?.subagent_type ?? 'unknown',
                    model: input?.model ?? undefined,
                    description: input?.description ?? undefined,
                    status: 'running',
                    startTime: timestamp,
                };
                state.agentMap.set(block.id, agentEntry);
            }
            else if (block.name === 'TodoWrite') {
                const input = block.input;
                if (input?.todos && Array.isArray(input.todos)) {
                    state.todos.length = 0;
                    state.taskIdToIndex.clear();
                    state.todos.push(...input.todos);
                }
            }
            else if (block.name === 'TaskCreate') {
                const input = block.input;
                const subject = typeof input?.subject === 'string' ? input.subject : '';
                const description = typeof input?.description === 'string' ? input.description : '';
                const content = subject || description || 'Untitled task';
                const status = normalizeTaskStatus(input?.status) ?? 'pending';
                state.todos.push({ content, status });
                const rawTaskId = input?.taskId;
                const taskId = typeof rawTaskId === 'string' || typeof rawTaskId === 'number'
                    ? String(rawTaskId)
                    : block.id;
                if (taskId) {
                    state.taskIdToIndex.set(taskId, state.todos.length - 1);
                }
            }
            else if (block.name === 'TaskUpdate') {
                const input = block.input;
                const index = resolveTaskIndex(input?.taskId, state.taskIdToIndex, state.todos);
                if (index !== null) {
                    const status = normalizeTaskStatus(input?.status);
                    if (status) {
                        state.todos[index].status = status;
                    }
                    const subject = typeof input?.subject === 'string' ? input.subject : '';
                    const description = typeof input?.description === 'string' ? input.description : '';
                    const content = subject || description;
                    if (content) {
                        state.todos[index].content = content;
                    }
                }
            }
            else {
                state.toolMap.set(block.id, toolEntry);
            }
        }
        if (block.type === 'tool_result' && block.tool_use_id) {
            const tool = state.toolMap.get(block.tool_use_id);
            if (tool) {
                tool.status = block.is_error ? 'error' : 'completed';
                tool.endTime = timestamp;
            }
            const agent = state.agentMap.get(block.tool_use_id);
            if (agent) {
                agent.status = 'completed';
                agent.endTime = timestamp;
            }
        }
    }
}
function extractTarget(toolName, input) {
    if (!input)
        return undefined;
    switch (toolName) {
        case 'Read':
        case 'Write':
        case 'Edit':
            return input.file_path ?? input.path;
        case 'Glob':
            return input.pattern;
        case 'Grep':
            return input.pattern;
        case 'Bash':
            const cmd = input.command;
            return cmd?.slice(0, 30) + (cmd?.length > 30 ? '...' : '');
    }
    return undefined;
}
function resolveTaskIndex(taskId, taskIdToIndex, latestTodos) {
    if (typeof taskId === 'string' || typeof taskId === 'number') {
        const key = String(taskId);
        const mapped = taskIdToIndex.get(key);
        if (typeof mapped === 'number') {
            return mapped;
        }
        if (/^\d+$/.test(key)) {
            const numericIndex = Number.parseInt(key, 10) - 1;
            if (numericIndex >= 0 && numericIndex < latestTodos.length) {
                return numericIndex;
            }
        }
    }
    return null;
}
function normalizeTaskStatus(status) {
    if (typeof status !== 'string')
        return null;
    switch (status) {
        case 'pending':
        case 'not_started':
            return 'pending';
        case 'in_progress':
        case 'running':
            return 'in_progress';
        case 'completed':
        case 'complete':
        case 'done':
            return 'completed';
        default:
            return null;
    }
}
//# sourceMappingURL=transcript.js.map