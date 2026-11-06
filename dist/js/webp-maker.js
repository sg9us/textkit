const MIN_DELAY = 20;
const MAX_DELAY = 60000;
const MAX_DIMENSION = 4096;

let initialized = false;

export function initWebPMaker({ notify = () => {} } = {}) {
  if (initialized) return;
  initialized = true;

  const $ = (selector) => document.querySelector(selector);
  const state = {
    frames: [],
    draggingId: null,
    currentFrame: 0,
    playing: true,
    previewTimer: null,
    resultUrl: null,
    encoding: false
  };

  const els = {
    dropZone: $('#dropZone'), fileInput: $('#frameFiles'), pickButton: $('#pickFrames'),
    uploadCopy: $('#uploadCopy'), workspace: $('#webpWorkspace'), frameList: $('#frameList'),
    frameSummary: $('#frameSummary'), sortButton: $('#sortFrames'), defaultDelay: $('#defaultDelay'),
    lastDelay: $('#lastDelay'), defaultDelayError: $('#defaultDelayError'), lastDelayError: $('#lastDelayError'),
    applyAll: $('#applyAllDelay'), applyLast: $('#applyLastDelay'), previewCanvas: $('#previewCanvas'),
    playButton: $('#previewPlay'), restartButton: $('#previewRestart'), previewStatus: $('#previewStatus'),
    previewLoop: $('#previewLoop'), totalDuration: $('#totalDuration'), sizeMode: $('#sizeMode'),
    outputWidth: $('#outputWidth'), outputHeight: $('#outputHeight'), fitMode: $('#fitMode'),
    background: $('#backgroundMode'), customColor: $('#customColor'), quality: $('#quality'),
    qualityValue: $('#qualityValue'), loopInfinite: $('#loopInfinite'), loopCount: $('#loopCount'),
    outputName: $('#webpFileName'), generateButton: $('#generateWebp'), progressBar: $('#encodeProgressBar'),
    encodeStatus: $('#encodeStatus'), result: $('#webpResult'), resultImage: $('#webpResultImage'),
    resultMeta: $('#webpResultMeta'), resultDownload: $('#webpResultDownload')
  };

  function escapeHTML(value) {
    return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function totalMs() { return state.frames.reduce((sum, frame) => sum + frame.delay, 0); }

  function validateDelay(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < MIN_DELAY || number > MAX_DELAY) {
      return { valid: false, message: `${MIN_DELAY.toLocaleString()}~${MAX_DELAY.toLocaleString()}ms의 정수를 입력해 주세요.` };
    }
    return { valid: true, value: number };
  }

  function isSupportedFile(file) {
    return /\.(png|jpe?g|webp)$/i.test(file.name) || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
  }

  function readFourCC(bytes, offset) {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  }

  function readU32(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function isAnimatedWebP(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 20 || readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') return false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = readFourCC(bytes, offset);
      const size = readU32(bytes, offset + 4);
      if (type === 'ANIM' || type === 'ANMF') return true;
      if (type === 'VP8X' && size >= 1 && (bytes[offset + 8] & 0x02)) return true;
      offset += 8 + size + (size & 1);
    }
    return false;
  }

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    let added = 0;
    const errors = [];
    for (const file of files) {
      if (!isSupportedFile(file)) { errors.push(`${file.name}: 지원하지 않는 형식`); continue; }
      try {
        if (/\.webp$/i.test(file.name) || file.type === 'image/webp') {
          const buffer = await file.arrayBuffer();
          if (isAnimatedWebP(buffer)) { errors.push(`${file.name}: Animated WebP 입력은 지원하지 않습니다.`); continue; }
        }
        const bitmap = await createImageBitmap(file);
        const objectUrl = URL.createObjectURL(file);
        state.frames.push({
          id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
          name: file.name,
          file,
          bitmap,
          objectUrl,
          width: bitmap.width,
          height: bitmap.height,
          delay: 1200,
          draftDelay: '1200',
          error: ''
        });
        added += 1;
      } catch (error) {
        errors.push(`${file.name}: 이미지를 읽을 수 없습니다.`);
      }
    }
    els.fileInput.value = '';
    if (added) {
      state.currentFrame = Math.min(state.currentFrame, state.frames.length - 1);
      state.playing = true;
      syncAutoSize();
      renderAll();
      startPreview();
      notify(`${added}개 프레임을 추가했습니다.`);
    }
    if (errors.length) setEncodeStatus(errors.join(' '), 'error');
  }

  function syncAutoSize() {
    const first = state.frames[0];
    if (!first) return;
    if (els.sizeMode.value === 'first') {
      els.outputWidth.value = first.width;
      els.outputHeight.value = first.height;
    }
  }

  function renderAll() {
    const hasFrames = state.frames.length > 0;
    els.workspace.hidden = !hasFrames;
    els.dropZone.classList.toggle('compact', hasFrames);
    els.uploadCopy.innerHTML = hasFrames
      ? `<div class="upload-compact-copy"><div class="upload-icon compact-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m6.5 16 4-4 3 3 2-2 2.5 3"/><path d="M16.5 7.5v5m-2.5-2.5h5"/></svg></div><div><div class="upload-title">이미지 추가</div><div class="upload-note">PNG, JPG, 정적 WebP · 현재 ${state.frames.length}개</div></div></div>`
      : `<div><div class="upload-icon" aria-hidden="true">＋</div><div class="upload-title">이미지를 놓거나 선택해 주세요</div><div class="upload-note">PNG, JPG/JPEG, 정적 WebP · 여러 파일 선택 가능</div></div>`;
    els.pickButton.textContent = hasFrames ? '이미지 추가' : '파일 선택';
    if (!hasFrames) return;
    renderFrames();
    updateSummary();
    updateSizeFields();
    renderPreview();
  }

  function renderFrames() {
    els.frameList.innerHTML = state.frames.map((frame, index) => `
      <article class="frame-card" draggable="true" data-id="${frame.id}">
        <span class="drag-handle" title="드래그하여 순서 변경" aria-hidden="true">⠿</span>
        <span class="frame-number">${index + 1}</span>
        <img class="frame-thumb" src="${frame.objectUrl}" alt="${escapeHTML(frame.name)} 미리보기">
        <div class="frame-info">
          <div class="frame-name" title="${escapeHTML(frame.name)}">${escapeHTML(frame.name)}</div>
          <div class="frame-size">${frame.width} × ${frame.height}</div>
          <div class="move-actions"><button type="button" data-move="up" aria-label="${index + 1}번 프레임 위로 이동" ${index === 0 ? 'disabled' : ''}>↑ 위로</button><button type="button" data-move="down" aria-label="${index + 1}번 프레임 아래로 이동" ${index === state.frames.length - 1 ? 'disabled' : ''}>↓ 아래로</button></div>
        </div>
        <label class="delay-field"><span class="sr-only">${index + 1}번 프레임 DELAY</span><input inputmode="numeric" value="${frame.draftDelay}" data-delay aria-label="${index + 1}번 프레임 DELAY (ms)" class="${frame.error ? 'invalid' : ''}"><small>${escapeHTML(frame.error)}</small></label>
        <div class="frame-actions"><button class="frame-icon-btn" type="button" data-duplicate aria-label="${index + 1}번 프레임 복제" title="복제"><svg class="frame-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="10" height="10" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></button><button class="frame-icon-btn danger" type="button" data-delete aria-label="${index + 1}번 프레임 삭제" title="삭제">×</button></div>
      </article>`).join('');

    els.frameList.querySelectorAll('.frame-card').forEach((card) => {
      const frame = state.frames.find((item) => item.id === card.dataset.id);
      card.addEventListener('dragstart', () => { state.draggingId = frame.id; card.classList.add('dragging'); });
      card.addEventListener('dragend', () => { state.draggingId = null; card.classList.remove('dragging'); });
      card.addEventListener('dragover', (event) => { event.preventDefault(); });
      card.addEventListener('drop', (event) => { event.preventDefault(); reorderById(state.draggingId, frame.id); });
      const delayInput = card.querySelector('[data-delay]');
      delayInput.addEventListener('input', (event) => { frame.draftDelay = event.target.value; frame.error = ''; event.target.classList.remove('invalid'); card.querySelector('small').textContent = ''; });
      delayInput.addEventListener('blur', () => commitFrameDelay(frame, delayInput));
      delayInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); delayInput.blur(); } });
      card.querySelector('[data-duplicate]').addEventListener('click', () => duplicateFrame(frame.id));
      card.querySelector('[data-delete]').addEventListener('click', () => deleteFrame(frame.id));
      card.querySelectorAll('[data-move]').forEach((button) => button.addEventListener('click', () => moveFrame(frame.id, button.dataset.move === 'up' ? -1 : 1)));
    });
  }

  function commitFrameDelay(frame, input) {
    const result = validateDelay(frame.draftDelay);
    if (!result.valid) {
      frame.error = `${result.message} ${frame.delay}ms로 복원했습니다.`;
      frame.draftDelay = String(frame.delay);
      input.value = frame.draftDelay;
      input.classList.add('invalid');
      input.parentElement.querySelector('small').textContent = frame.error;
      return;
    }
    frame.delay = result.value;
    frame.draftDelay = String(result.value);
    frame.error = '';
    input.classList.remove('invalid');
    input.parentElement.querySelector('small').textContent = '';
    updateSummary();
    restartPreviewTimer();
  }

  function reorderById(sourceId, targetId) {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = state.frames.findIndex((frame) => frame.id === sourceId);
    const targetIndex = state.frames.findIndex((frame) => frame.id === targetId);
    const [moved] = state.frames.splice(sourceIndex, 1);
    const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    state.frames.splice(adjustedTarget, 0, moved);
    state.currentFrame = 0;
    renderAll();
    restartPreviewTimer();
  }

  function moveFrame(id, direction) {
    const index = state.frames.findIndex((frame) => frame.id === id);
    const next = index + direction;
    if (next < 0 || next >= state.frames.length) return;
    [state.frames[index], state.frames[next]] = [state.frames[next], state.frames[index]];
    state.currentFrame = 0;
    renderAll();
    restartPreviewTimer();
  }

  function duplicateFrame(id) {
    const index = state.frames.findIndex((frame) => frame.id === id);
    const source = state.frames[index];
    const duplicate = { ...source, id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: `${source.name.replace(/(\.[^.]+)$/, '')}_copy${source.name.match(/\.[^.]+$/)?.[0] || ''}`, error: '' };
    state.frames.splice(index + 1, 0, duplicate);
    renderAll();
    restartPreviewTimer();
  }

  function deleteFrame(id) {
    const index = state.frames.findIndex((frame) => frame.id === id);
    const [removed] = state.frames.splice(index, 1);
    if (!state.frames.some((frame) => frame.objectUrl === removed.objectUrl)) {
      URL.revokeObjectURL(removed.objectUrl);
      removed.bitmap.close?.();
    }
    state.currentFrame = Math.min(state.currentFrame, Math.max(0, state.frames.length - 1));
    syncAutoSize();
    renderAll();
    restartPreviewTimer();
  }

  function applyCommonDelay(input, errorElement, target) {
    const result = validateDelay(input.value);
    if (!result.valid) { input.classList.add('invalid'); errorElement.textContent = result.message; return; }
    input.classList.remove('invalid'); errorElement.textContent = '';
    if (!state.frames.length) return;
    if (target === 'all') state.frames.forEach((frame) => { frame.delay = result.value; frame.draftDelay = String(result.value); frame.error = ''; });
    else { const frame = state.frames[state.frames.length - 1]; frame.delay = result.value; frame.draftDelay = String(result.value); frame.error = ''; }
    renderAll();
    restartPreviewTimer();
    notify(target === 'all' ? '모든 프레임에 DELAY를 적용했습니다.' : '마지막 프레임에 DELAY를 적용했습니다.');
  }

  function updateSummary() {
    const seconds = totalMs() / 1000;
    els.frameSummary.textContent = `${state.frames.length}개 프레임 · ${seconds.toFixed(seconds % 1 ? 1 : 0)}초`;
    els.totalDuration.textContent = `전체 재생 시간 ${seconds.toFixed(seconds % 1 ? 1 : 0)}초`;
  }

  function outputSize() {
    const first = state.frames[0];
    if (!first) return { width: 1, height: 1 };
    if (els.sizeMode.value === 'first') return { width: first.width, height: first.height };
    return { width: Number(els.outputWidth.value) || first.width, height: Number(els.outputHeight.value) || first.height };
  }

  function updateSizeFields() {
    const automatic = els.sizeMode.value === 'first';
    els.outputWidth.disabled = automatic;
    els.outputHeight.disabled = automatic;
    if (automatic) syncAutoSize();
    els.customColor.hidden = els.background.value !== 'custom';
    els.loopCount.disabled = els.loopInfinite.checked;
  }

  function paintFrame(context, bitmap, width, height) {
    context.clearRect(0, 0, width, height);
    const background = els.background.value;
    if (background !== 'transparent') {
      context.fillStyle = background === 'white' ? '#ffffff' : background === 'black' ? '#000000' : els.customColor.value;
      context.fillRect(0, 0, width, height);
    }
    const scale = els.fitMode.value === 'fill' ? Math.max(width / bitmap.width, height / bitmap.height) : Math.min(width / bitmap.width, height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    const centerX = Math.round((width - drawWidth) / 2);
    const centerY = Math.round((height - drawHeight) / 2);
    context.drawImage(bitmap, centerX, centerY, drawWidth, drawHeight);
  }

  function renderPreview() {
    if (!state.frames.length) return;
    state.currentFrame = Math.min(state.currentFrame, state.frames.length - 1);
    const frame = state.frames[state.currentFrame];
    const size = outputSize();
    const scale = Math.min(1, 600 / size.width, 600 / size.height);
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    if (els.previewCanvas.width !== width || els.previewCanvas.height !== height) { els.previewCanvas.width = width; els.previewCanvas.height = height; }
    paintFrame(els.previewCanvas.getContext('2d'), frame.bitmap, width, height);
    els.previewStatus.textContent = `${state.currentFrame + 1} / ${state.frames.length} · ${frame.delay}ms`;
    els.playButton.textContent = state.playing ? '일시정지' : '재생';
  }

  function startPreview() {
    clearTimeout(state.previewTimer);
    if (!state.frames.length || !state.playing) return;
    renderPreview();
    state.previewTimer = setTimeout(() => {
      if (state.currentFrame >= state.frames.length - 1) {
        if (!els.previewLoop.checked) { state.playing = false; renderPreview(); return; }
        state.currentFrame = 0;
      } else state.currentFrame += 1;
      startPreview();
    }, state.frames[state.currentFrame].delay);
  }

  function restartPreviewTimer() { clearTimeout(state.previewTimer); renderPreview(); startPreview(); }

  function setEncodeStatus(message, type = '') {
    els.encodeStatus.textContent = message;
    els.encodeStatus.className = `encode-status ${type}`.trim();
  }

  function validateOutput() {
    if (state.frames.length < 2) return '애니메이션을 만들려면 이미지가 2장 이상 필요합니다.';
    const { width, height } = outputSize();
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return `출력 크기는 1~${MAX_DIMENSION}px의 정수로 입력해 주세요.`;
    if (width * height > 16777216) return '출력 픽셀 수가 너무 큽니다. 가로×세로를 16,777,216 이하로 줄여 주세요.';
    if (!els.loopInfinite.checked) {
      const loops = Number(els.loopCount.value);
      if (!Number.isInteger(loops) || loops < 1 || loops > 65535) return '반복 횟수는 1~65,535 사이의 정수여야 합니다.';
    }
    return '';
  }

  function canvasToWebP(canvas, quality) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('이 브라우저의 WebP 인코더를 사용할 수 없습니다.')), 'image/webp', quality));
  }

  function ascii(text) { return Uint8Array.from([...text].map((char) => char.charCodeAt(0))); }
  function u16(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255); }
  function u24(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255); }
  function u32(value) { return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  function concat(parts) { const length = parts.reduce((sum, part) => sum + part.length, 0); const output = new Uint8Array(length); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; }
  function riffChunk(type, payload) { return concat([ascii(type), u32(payload.length), payload, ...(payload.length & 1 ? [Uint8Array.of(0)] : [])]); }

  function extractImageChunks(buffer) {
    const bytes = new Uint8Array(buffer);
    if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') throw new Error('프레임 WebP 인코딩 결과가 올바르지 않습니다.');
    const chunks = [];
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = readFourCC(bytes, offset);
      const size = readU32(bytes, offset + 4);
      const total = 8 + size + (size & 1);
      if (['ALPH', 'VP8 ', 'VP8L'].includes(type)) chunks.push(bytes.slice(offset, offset + total));
      offset += total;
    }
    if (!chunks.some((chunk) => ['VP8 ', 'VP8L'].includes(readFourCC(chunk, 0)))) throw new Error('WebP 프레임 비트스트림을 찾지 못했습니다.');
    return chunks;
  }

  function backgroundBGRA() {
    const mode = els.background.value;
    if (mode === 'transparent') return Uint8Array.of(0, 0, 0, 0);
    const hex = mode === 'white' ? '#ffffff' : mode === 'black' ? '#000000' : els.customColor.value;
    const value = Number.parseInt(hex.slice(1), 16);
    return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, 255);
  }

  function makeAnimatedWebP(encodedFrames, width, height, loopCount) {
    const hasAlpha = els.background.value === 'transparent';
    const vp8x = concat([Uint8Array.of(0x02 | (hasAlpha ? 0x10 : 0), 0, 0, 0), u24(width - 1), u24(height - 1)]);
    const anim = concat([backgroundBGRA(), u16(loopCount)]);
    const frameChunks = encodedFrames.map(({ chunks, delay }) => {
      const header = concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(delay), Uint8Array.of(0x02)]);
      return riffChunk('ANMF', concat([header, ...chunks]));
    });
    const body = concat([riffChunk('VP8X', vp8x), riffChunk('ANIM', anim), ...frameChunks]);
    return concat([ascii('RIFF'), u32(body.length + 4), ascii('WEBP'), body]);
  }

  function inspectAnimatedWebP(bytes) {
    if (readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WEBP') throw new Error('RIFF/WEBP 헤더 검증에 실패했습니다.');
    let offset = 12, frames = 0, hasAnimation = false, hasAnimChunk = false;
    const durations = [];
    while (offset + 8 <= bytes.length) {
      const type = readFourCC(bytes, offset), size = readU32(bytes, offset + 4);
      if (type === 'VP8X') hasAnimation = Boolean(bytes[offset + 8] & 0x02);
      if (type === 'ANIM') hasAnimChunk = true;
      if (type === 'ANMF') { frames += 1; durations.push(bytes[offset + 20] | (bytes[offset + 21] << 8) | (bytes[offset + 22] << 16)); }
      offset += 8 + size + (size & 1);
    }
    if (!hasAnimation || !hasAnimChunk || frames < 2) throw new Error('Animated WebP 구조 검증에 실패했습니다.');
    return { frames, durations };
  }

  async function generateAndSave() {
    const validationError = validateOutput();
    if (validationError) { setEncodeStatus(validationError, 'error'); return; }
    const fileName = `${(els.outputName.value || 'animation').trim().replace(/\.webp$/i, '').replace(/[\\/:*?"<>|]+/g, '') || 'animation'}.webp`;
    let fileHandle = null;
    if (typeof window.showSaveFilePicker === 'function') {
      try { fileHandle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'Animated WebP', accept: { 'image/webp': ['.webp'] } }] }); }
      catch (error) { if (error?.name === 'AbortError') return; setEncodeStatus(`저장 창을 열 수 없습니다: ${error.message}`, 'error'); return; }
    }
    state.encoding = true;
    els.generateButton.disabled = true;
    els.generateButton.textContent = 'WebP 생성 중…';
    els.progressBar.style.width = '2%';
    els.result.hidden = true;
    setEncodeStatus('프레임을 WebP로 인코딩하고 있습니다.');
    try {
      const { width, height } = outputSize();
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      const encodedFrames = [];
      for (let index = 0; index < state.frames.length; index += 1) {
        const frame = state.frames[index];
        paintFrame(context, frame.bitmap, width, height);
        const blob = await canvasToWebP(canvas, Number(els.quality.value) / 100);
        encodedFrames.push({ chunks: extractImageChunks(await blob.arrayBuffer()), delay: frame.delay });
        els.progressBar.style.width = `${Math.round(((index + 1) / state.frames.length) * 85)}%`;
        setEncodeStatus(`${index + 1} / ${state.frames.length} 프레임 인코딩 중`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const loopCount = els.loopInfinite.checked ? 0 : Number(els.loopCount.value);
      const bytes = makeAnimatedWebP(encodedFrames, width, height, loopCount);
      const inspected = inspectAnimatedWebP(bytes);
      if (inspected.frames !== state.frames.length || inspected.durations.some((duration, index) => duration !== state.frames[index].delay)) throw new Error('프레임 수 또는 DELAY 검증에 실패했습니다.');
      const blob = new Blob([bytes], { type: 'image/webp' });
      if (fileHandle) { const writable = await fileHandle.createWritable(); await writable.write(blob); await writable.close(); }
      else { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultUrl = URL.createObjectURL(blob);
      els.resultImage.src = state.resultUrl;
      els.resultMeta.textContent = `${inspected.frames}개 프레임 · ${width}×${height} · ${formatBytes(blob.size)}`;
      els.resultDownload.href = state.resultUrl;
      els.resultDownload.download = fileName;
      els.result.hidden = false;
      els.progressBar.style.width = '100%';
      setEncodeStatus(`생성 및 저장 완료 · ${formatBytes(blob.size)}`, 'success');
      notify('Animated WebP 저장을 완료했습니다.');
    } catch (error) {
      setEncodeStatus(`생성 실패: ${error.message} 이미지 크기를 줄이거나 다시 시도해 주세요.`, 'error');
      els.progressBar.style.width = '0%';
    } finally {
      state.encoding = false;
      els.generateButton.disabled = false;
      els.generateButton.textContent = 'WebP 저장';
    }
  }

  els.pickButton.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (event) => addFiles(event.target.files));
  ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (event) => { event.preventDefault(); els.dropZone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, (event) => { event.preventDefault(); els.dropZone.classList.remove('dragover'); }));
  els.dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
  els.sortButton.addEventListener('click', () => { state.frames.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })); state.currentFrame = 0; renderAll(); restartPreviewTimer(); });
  els.applyAll.addEventListener('click', () => applyCommonDelay(els.defaultDelay, els.defaultDelayError, 'all'));
  els.applyLast.addEventListener('click', () => applyCommonDelay(els.lastDelay, els.lastDelayError, 'last'));
  els.playButton.addEventListener('click', () => { state.playing = !state.playing; restartPreviewTimer(); });
  els.restartButton.addEventListener('click', () => { state.currentFrame = 0; state.playing = true; restartPreviewTimer(); });
  els.previewLoop.addEventListener('change', restartPreviewTimer);
  els.sizeMode.addEventListener('change', () => { updateSizeFields(); renderPreview(); });
  [els.outputWidth, els.outputHeight, els.fitMode, els.background, els.customColor].forEach((element) => element.addEventListener('input', () => { updateSizeFields(); renderPreview(); }));
  els.quality.addEventListener('input', () => { els.qualityValue.textContent = els.quality.value; });
  els.loopInfinite.addEventListener('change', updateSizeFields);
  els.generateButton.addEventListener('click', generateAndSave);
  window.addEventListener('beforeunload', () => { state.frames.forEach((frame, index, all) => { if (all.findIndex((item) => item.objectUrl === frame.objectUrl) === index) URL.revokeObjectURL(frame.objectUrl); frame.bitmap.close?.(); }); if (state.resultUrl) URL.revokeObjectURL(state.resultUrl); });

  renderAll();
  updateSizeFields();
}
