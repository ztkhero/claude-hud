import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../dist/transcript.js';
import * as path from 'node:path';
import { mkdtemp, rm, writeFile, appendFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';

/** Dates don't survive deepEqual across parses cleanly; compare a stable projection */
function normalize(result) {
  return JSON.stringify(result, (_key, value) =>
    value instanceof Date ? value.toISOString() : value);
}

/** Entries are padded so the file clears the 1MB threshold that enables caching */
function makeLines(count, { pad = 600, startIndex = 0 } = {}) {
  const lines = [];
  for (let i = startIndex; i < startIndex + count; i++) {
    const ts = new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();
    lines.push(JSON.stringify({
      type: i % 2 === 0 ? 'user' : 'assistant',
      timestamp: ts,
      filler: 'x'.repeat(pad),
      message: {
        usage: { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 10 } },
        content: [{ type: 'tool_use', id: `tool-${i}`, name: 'Read', input: { file_path: `/tmp/${i}.txt` } }],
      },
    }));
  }
  return lines;
}

async function withWorkspace(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'claude-hud-cache-'));
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'config');
  try {
    return await fn(dir, path.join(dir, 'transcript.jsonl'));
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

/** Parse the same file with the cache bypassed, for comparison */
async function parseUncached(file) {
  process.env.CLAUDE_HUD_TRANSCRIPT_CACHE = '0';
  try {
    return await parseTranscript(file);
  } finally {
    delete process.env.CLAUDE_HUD_TRANSCRIPT_CACHE;
  }
}

test('incremental parse of appended lines matches a full parse', async () => {
  await withWorkspace(async (_dir, file) => {
    await writeFile(file, makeLines(1200).join('\n') + '\n', 'utf8');
    await parseTranscript(file); // seeds the cache

    await appendFile(file, makeLines(40, { startIndex: 1200 }).join('\n') + '\n', 'utf8');
    const incremental = await parseTranscript(file);

    assert.equal(normalize(incremental), normalize(await parseUncached(file)));
    assert.equal(incremental.tools.length, 20);
    assert.equal(incremental.cacheTtlSeconds, 3600);
  });
});

test('repeated parses with no new lines stay correct', async () => {
  await withWorkspace(async (_dir, file) => {
    await writeFile(file, makeLines(1200).join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    const first = await parseTranscript(file);
    const second = await parseTranscript(file);

    assert.equal(normalize(first), normalize(second));
    assert.equal(normalize(first), normalize(await parseUncached(file)));
  });
});

test('a truncated transcript falls back to a full parse', async () => {
  await withWorkspace(async (_dir, file) => {
    await writeFile(file, makeLines(1200).join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    // A shorter file at the same path is a different stream, not an append
    await writeFile(file, makeLines(1100, { startIndex: 5000 }).join('\n') + '\n', 'utf8');
    const reparsed = await parseTranscript(file);

    assert.equal(normalize(reparsed), normalize(await parseUncached(file)));
    assert.equal(reparsed.tools[19].id, 'tool-6099');
  });
});

test('an in-place rewrite behind the offset falls back to a full parse', async () => {
  await withWorkspace(async (_dir, file) => {
    const lines = makeLines(1200);
    await writeFile(file, lines.join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    // Same byte length, different content, and it rewrites the FIRST entry —
    // which decides sessionStart, so a wrongly reused cache would show through.
    // Size and mtime both still look like a plain append; only the fingerprint catches it.
    const rewritten = [...lines];
    rewritten[0] = rewritten[0].replace('2024-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
    assert.equal(rewritten[0].length, lines[0].length, 'rewrite must not change byte length');
    await writeFile(file, rewritten.join('\n') + '\n', 'utf8');

    const reparsed = await parseTranscript(file);
    assert.equal(normalize(reparsed), normalize(await parseUncached(file)));
    assert.equal(reparsed.sessionStart?.toISOString(), '2099-01-01T00:00:00.000Z');
  });
});

test('a half-written trailing line is deferred until complete', async () => {
  await withWorkspace(async (_dir, file) => {
    await writeFile(file, makeLines(1200).join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    await appendFile(file, '{"type":"user","timesta', 'utf8');
    const midWrite = await parseTranscript(file);
    assert.equal(normalize(midWrite), normalize(await parseUncached(file)));

    await appendFile(file, 'mp":"2030-01-01T00:00:00.000Z"}\n', 'utf8');
    const completed = await parseTranscript(file);
    assert.equal(completed.lastRequestAt?.toISOString(), '2030-01-01T00:00:00.000Z');
    assert.equal(normalize(completed), normalize(await parseUncached(file)));
  });
});

test('small transcripts skip the cache entirely', async () => {
  await withWorkspace(async (dir, file) => {
    await writeFile(file, makeLines(5, { pad: 10 }).join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    const cacheDir = path.join(dir, 'config', 'plugins', 'claude-hud', 'transcript-cache');
    await assert.rejects(() => readdir(cacheDir), /ENOENT/);
  });
});

test('the cache survives a corrupted entry', async () => {
  await withWorkspace(async (dir, file) => {
    await writeFile(file, makeLines(1200).join('\n') + '\n', 'utf8');
    await parseTranscript(file);

    const cacheDir = path.join(dir, 'config', 'plugins', 'claude-hud', 'transcript-cache');
    const [entry] = await readdir(cacheDir);
    await writeFile(path.join(cacheDir, entry), '{ not json', 'utf8');

    const reparsed = await parseTranscript(file);
    assert.equal(normalize(reparsed), normalize(await parseUncached(file)));

    // And the bad entry is replaced, not left to poison later renders
    const rewritten = await readFile(path.join(cacheDir, entry), 'utf8');
    assert.equal(JSON.parse(rewritten).version, 2);
  });
});
