import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { parse, resolve, dirname } from 'node:path';
import { Buffer } from 'node:buffer';

const LIMIT = 8 * 1024 * 1024;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const invalid = () => { throw new Error('SAVED_REPORT_INVALID'); };

/** Check JSON grammar and resource ceilings before constructing an object. */
export function parseSavedReport(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > LIMIT) invalid();
  let at = 0;
  let nodes = 0;
  const whitespace = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at += 1; };
  const string = () => {
    if (text[at] !== '"') invalid();
    const start = at++;
    while (at < text.length) {
      const char = text[at++];
      if (char === '"') {
        const raw = text.slice(start, at);
        try { return JSON.parse(raw); } catch { invalid(); }
      }
      if (char.charCodeAt(0) < 32) invalid();
      if (char !== '\\') continue;
      const escape = text[at++];
      if (escape === 'u') {
        if (!/^[0-9a-fA-F]{4}$/.test(text.slice(at, at + 4))) invalid();
        at += 4;
      } else if (!'"\\/bfnrt'.includes(escape ?? '')) invalid();
    }
    invalid();
  };
  const value = (depth) => {
    whitespace();
    if (++nodes > 200000 || depth > 32) invalid();
    const char = text[at];
    if (char === '"') { string(); return; }
    if (char === '{' || char === '[') {
      at += 1;
      const object = char === '{';
      const keys = object ? new Set() : null;
      let entries = 0;
      whitespace();
      if (text[at] === (object ? '}' : ']')) { at += 1; return; }
      while (true) {
        if (object) {
          const key = string();
          if (keys.has(key)) invalid();
          keys.add(key);
          whitespace();
          if (text[at++] !== ':') invalid();
        }
        value(depth + 1);
        if (++entries > (object ? 200000 : 50000)) invalid();
        whitespace();
        if (text[at] === (object ? '}' : ']')) { at += 1; return; }
        if (text[at++] !== ',') invalid();
        whitespace();
      }
    }
    if (char === 't' && text.slice(at, at + 4) === 'true') { at += 4; return; }
    if (char === 'f' && text.slice(at, at + 5) === 'false') { at += 5; return; }
    if (char === 'n' && text.slice(at, at + 4) === 'null') { at += 4; return; }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(text);
    if (!number || !Number.isFinite(Number(number[0]))) invalid();
    at += number[0].length;
  };
  value(0);
  whitespace();
  if (at !== text.length) invalid();
  try {
    const report = JSON.parse(text);
    if (report === null || typeof report !== 'object' || Array.isArray(report)) invalid();
    return report;
  } catch { invalid(); }
}

const same = (a, b) => a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

/** Read one unchanged regular file; never follow a link at any path component. */
export async function readSavedReport(path) {
  try {
    if (typeof path !== 'string' || !path) invalid();
    const absolute = resolve(path);
    const root = parse(absolute).root;
    const parts = [];
    for (let cursor = absolute; cursor !== root; cursor = dirname(cursor)) parts.push(cursor);
    for (const component of parts.reverse()) if ((await lstat(component)).isSymbolicLink()) invalid();
    const before = await lstat(absolute, { bigint: true });
    if (!before.isFile() || before.size > BigInt(LIMIT)) invalid();
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      if (!same(before, await handle.stat({ bigint: true }))) invalid();
      const bytes = Buffer.alloc(LIMIT + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await handle.read(bytes, length, bytes.length - length, length);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > LIMIT || !same(before, await handle.stat({ bigint: true })) ||
        !same(before, await lstat(absolute, { bigint: true }))) invalid();
      return parseSavedReport(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } finally { await handle.close(); }
  } catch { invalid(); }
}
