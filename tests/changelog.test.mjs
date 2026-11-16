import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function loadBrowserData(path, key) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window[key];
}

test('changelog starts with the shared current app version', async () => {
  const config = await loadBrowserData('../dist/js/config.js', 'TEXTKIT_CONFIG');
  const changelog = await loadBrowserData('../dist/js/changelog.js', 'TEXTKIT_CHANGELOG');
  assert.equal(changelog[0].version, config.version);
  assert.equal(changelog.filter(entry => entry.version === config.version).length, 1);
});

test('changelog versions are unique and newest first', async () => {
  const changelog = await loadBrowserData('../dist/js/changelog.js', 'TEXTKIT_CHANGELOG');
  const versions = changelog.map(entry => entry.version);
  assert.equal(new Set(versions).size, versions.length);
  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1].split('.').map(Number);
    const current = versions[index].split('.').map(Number);
    assert.ok(previous[0] > current[0] || previous[0] === current[0] && (previous[1] > current[1] || previous[1] === current[1] && previous[2] > current[2]));
  }
});

test('every changelog entry has concise user-facing changes', async () => {
  const changelog = await loadBrowserData('../dist/js/changelog.js', 'TEXTKIT_CHANGELOG');
  for (const entry of changelog) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.ok(entry.date === null || /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
    assert.ok(entry.changes.length >= 1 && entry.changes.length <= 3);
    entry.changes.forEach(change => assert.ok(change.length > 0));
  }
});
