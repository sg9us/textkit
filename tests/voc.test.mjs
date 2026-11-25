import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateRandomNickname } from '../dist/js/voc.js';

test('VOC nickname is generated as adjective plus noun', () => {
  assert.equal(generateRandomNickname(() => 0), '수줍은 감자');
  assert.match(generateRandomNickname(() => 0.999), /^\S+(?: \S+)* \S+$/);
});

test('VOC form has no title field and uses an editable generated nickname', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="vocTitle"/);
  assert.match(html, /id="vocContent"/);
  assert.match(html, /id="vocNickname"[^>]*readonly/);
  assert.match(html, /id="vocNicknameEdit"/);
});

test('Apps Script stores nickname without adding or deleting data columns', async () => {
  const code = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(code, /\['ID', '작성일시', '유형', '닉네임', '내용', '처리상태'\]/);
  assert.match(code, /legacyHeaders/);
  assert.match(code, /Utilities\.getUuid\(\)/);
});

test('Apps Script applies a strict dropdown to the status column', async () => {
  const code = await readFile(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(code, /requireValueInList\(STATUSES, true\)/);
  assert.match(code, /setAllowInvalid\(false\)/);
  assert.match(code, /ensureStatusDropdown_\(sheet\)/);
});
