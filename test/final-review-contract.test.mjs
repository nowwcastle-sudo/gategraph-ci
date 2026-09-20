import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseDocument } from 'yaml';

test('directly proves the YAML 1.2 on key remains a string', () => {
  const doc = parseDocument('on: pull_request\njobs: {}\n');

  assert.equal(doc.errors.length, 0);
  const value = doc.toJS();
  assert.equal(Object.hasOwn(value, 'on'), true);
  assert.equal(typeof [...doc.contents.items].find((pair) => pair.key.value === 'on').key.value, 'string');
  assert.equal(value.on, 'pull_request');
});

test('README discloses that live collection does not infer voting policy', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /live collection does not infer voting policy/i);
  assert.match(readme, /policy-review/i);
  assert.match(readme, /explicit policy contract/i);
});
