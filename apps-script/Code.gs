// 비공개 스프레드시트의 ID를 입력한 뒤 웹앱으로 배포합니다.
const SHEET_ID = 'REPLACE_WITH_SPREADSHEET_ID';
const SHEET_NAME = 'VOC';
const HEADERS = ['ID', '작성일시', '유형', '작성자', '내용', '처리상태'];
const TYPES = ['bug', 'improvement', 'etc'];
const STATUSES = ['open', 'reviewing', 'done'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Bridge')
    .setTitle('Textkit VOC bridge')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function vocSheet_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('VOC 시트를 찾을 수 없습니다.');
  return sheet;
}

function normalizeInput_(value, max) {
  if (typeof value !== 'string') throw new Error('입력값이 올바르지 않습니다.');
  const result = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!result || result.length > max) throw new Error('입력 길이를 확인해 주세요.');
  return result;
}

function safeCell_(value) {
  // Sheets의 수식 실행을 막고 원문이 게시판에는 그대로 보이도록 보관합니다.
  return /^[\s\uFEFF]*[=+\-@]/.test(value) ? "'" + value : value;
}

function displayCell_(value) {
  const text = String(value || '');
  return text.startsWith("'") ? text.slice(1) : text;
}

function rowObject_(row) {
  return {
    id: String(row[0] || ''),
    created_at: row[1] instanceof Date ? row[1].toISOString() : new Date(row[1]).toISOString(),
    type: TYPES.includes(row[2]) ? row[2] : 'etc',
    author: displayCell_(row[3]),
    content: displayCell_(row[4]),
    status: STATUSES.includes(row[5]) ? row[5] : 'open'
  };
}

function listVoc() {
  const sheet = vocSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 6).getValues()
    .filter(row => row[0])
    .map(rowObject_)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
    .slice(0, 200);
}

function submitVoc(input) {
  if (!input || !TYPES.includes(input.type)) throw new Error('제보 유형을 확인해 주세요.');
  const author = normalizeInput_(input.author, 40);
  const content = normalizeInput_(input.content, 3000);
  const sheet = vocSheet_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('잠시 후 다시 시도해 주세요.');
  try {
    if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
    const id = Utilities.getUuid(), created = new Date();
    sheet.appendRow([id, created, input.type, safeCell_(author), safeCell_(content), 'open']);
    SpreadsheetApp.flush();
    const saved = sheet.getRange(sheet.getLastRow(), 1, 1, 6).getValues()[0];
    if (String(saved[0]) !== id) throw new Error('저장 결과를 확인할 수 없습니다.');
    return rowObject_(saved);
  } finally { lock.releaseLock(); }
}
