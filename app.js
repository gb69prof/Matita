(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const toolPen = document.getElementById('toolPen');
  const toolEraser = document.getElementById('toolEraser');
  const colorInput = document.getElementById('color');
  const sizeInput = document.getElementById('size');
  const sizeVal = document.getElementById('sizeVal');
  const bgInput = document.getElementById('bg');
  const btnGrid = document.getElementById('btnGrid');

  const btnUndo = document.getElementById('btnUndo');
  const btnRedo = document.getElementById('btnRedo');
  const btnClear = document.getElementById('btnClear');
  const btnFullscreen = document.getElementById('btnFullscreen');

  const btnSavePng = document.getElementById('btnSavePng');
  const btnSaveProject = document.getElementById('btnSaveProject');
  const btnOpenProject = document.getElementById('btnOpenProject');
  const btnImportImage = document.getElementById('btnImportImage');
  const fileInput = document.getElementById('fileInput');

  const toastEl = document.getElementById('toast');

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let bgColor = bgInput.value;
  let showGrid = false;

  let tool = 'pen';
  let penColor = colorInput.value;
  let baseSize = Number(sizeInput.value);

  const strokes = [];

  const history = [];
  const redoStack = [];
  const HISTORY_LIMIT = 50;

  let drawing = false;
  let activePointerId = null;
  let lastPt = null;
  let lastPressure = 0.5;
  let pendingPts = [];
  let rafId = 0;

  function toast(msg){
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.style.opacity = '0', 1400);
  }

  function setTool(next){
    tool = next;
    toolPen.classList.toggle('selected', tool === 'pen');
    toolEraser.classList.toggle('selected', tool === 'eraser');
  }

  function setPenColor(hex){
    penColor = hex;
    colorInput.value = hex;
  }

  function logicalSize(){
    return { w: canvas.width / dpr, h: canvas.height / dpr };
  }

  function drawBackground(){
    const { w, h } = logicalSize();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  function renderGrid(){
    if(!showGrid) return;
    const { w, h } = logicalSize();
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.14;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    const step = 32;
    ctx.beginPath();
    for(let x=0; x<=w; x+=step){
      ctx.moveTo(x+0.5, 0); ctx.lineTo(x+0.5, h);
    }
    for(let y=0; y<=h; y+=step){
      ctx.moveTo(0, y+0.5); ctx.lineTo(w, y+0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function snapshot(){
    try{
      history.push(canvas.toDataURL('image/png'));
      if(history.length > HISTORY_LIMIT) history.shift();
      redoStack.length = 0;
      updateUndoRedo();
    }catch(e){ console.warn('snapshot failed', e); }
  }

  function updateUndoRedo(){
    btnUndo.disabled = history.length === 0;
    btnRedo.disabled = redoStack.length === 0;
  }

  function restoreFromDataUrl(dataUrl){
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(img, 0, 0, logicalSize().w, logicalSize().h);
      ctx.restore();
      if(showGrid) renderGrid();
    };
    img.src = dataUrl;
  }

  function undo(){
    if(history.length === 0) return;
    const prev = history.pop();
    redoStack.push(canvas.toDataURL('image/png'));
    restoreFromDataUrl(prev);
    updateUndoRedo();
  }

  function redo(){
    if(redoStack.length === 0) return;
    history.push(canvas.toDataURL('image/png'));
    const next = redoStack.pop();
    restoreFromDataUrl(next);
    updateUndoRedo();
  }

  function clearBoard(){
    snapshot();
    strokes.length = 0;
    drawBackground();
    if(showGrid) renderGrid();
    toast('Pulito');
  }

  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, window.devicePixelRatio || 1);

    const prev = document.createElement('canvas');
    prev.width = canvas.width;
    prev.height = canvas.height;
    prev.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;

    if(prev.width && prev.height){
      const img = new Image();
      img.onload = () => {
        drawBackground();
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.drawImage(img, 0, 0, logicalSize().w, logicalSize().h);
        ctx.restore();
        if(showGrid) renderGrid();
      };
      img.src = prev.toDataURL('image/png');
    }else{
      drawBackground();
      if(showGrid) renderGrid();
    }
  }

  function getPointFromEvent(evt){
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);

    let p = (typeof evt.pressure === 'number') ? evt.pressure : 0.5;
    if(!p || p <= 0) p = lastPressure || 0.5;
    p = Math.max(0.1, Math.min(1.0, p));
    lastPressure = p;

    return { x, y, p, pointerType: evt.pointerType || 'touch' };
  }

  function beginDraw(evt){
    if(drawing) return;
    drawing = true;
    activePointerId = evt.pointerId;
    canvas.setPointerCapture(activePointerId);

    snapshot(); // snapshot BEFORE modifying pixels: undo works correctly

    pendingPts.length = 0;
    const pt = getPointFromEvent(evt);
    lastPt = pt;
    pendingPts.push(pt);

    strokes.push({
      tool,
      color: penColor,
      baseSize,
      pointerType: pt.pointerType,
      points: [{x: pt.x, y: pt.y, p: pt.p, t: performance.now()}]
    });

    scheduleRender();
  }

  function extendDraw(evt){
    if(!drawing || evt.pointerId !== activePointerId) return;
    const events = (typeof evt.getCoalescedEvents === 'function') ? evt.getCoalescedEvents() : [evt];
    for(const e of events){
      const pt = getPointFromEvent(e);
      pendingPts.push(pt);
      const st = strokes[strokes.length - 1];
      if(st) st.points.push({x: pt.x, y: pt.y, p: pt.p, t: performance.now()});
    }
    scheduleRender();
  }

  function endDraw(){
    if(!drawing) return;
    drawing = false;
    activePointerId = null;
    lastPt = null;
    pendingPts.length = 0;
    if(rafId){ cancelAnimationFrame(rafId); rafId = 0; }
  }

  function scheduleRender(){
    if(rafId) return;
    rafId = requestAnimationFrame(renderPending);
  }

  function strokeWidth(pt){
    const pressureMult = 0.85 + (pt.p * 0.6);
    return Math.max(1, baseSize * pressureMult);
  }

  function drawSegment(a, b, pt){
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = (tool === 'eraser') ? bgColor : penColor;
    ctx.lineWidth = strokeWidth(pt);

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(a.x, a.y, midX, midY);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(pt){
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = (tool === 'eraser') ? bgColor : penColor;
    const r = strokeWidth(pt) / 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function renderPending(){
    rafId = 0;
    if(pendingPts.length === 0) return;

    const pts = pendingPts;
    pendingPts = [];

    // Avoid "missing start": always dot the first point of a stroke
    if(pts.length){
      const st = strokes[strokes.length - 1];
      if(st && st.points.length === 1){
        drawDot(pts[0]);
      }
    }

    let a = lastPt || pts[0];
    for(const b of pts){
      if(a && b) drawSegment(a, b, b);
      a = b;
    }
    lastPt = a;

    if(showGrid) renderGrid();
    if(pendingPts.length > 0) scheduleRender();
  }

  function safeFilename(prefix, ext){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${prefix}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  }

  async function saveWithPicker(blob, suggestedName){
    if(!window.showSaveFilePicker) return false;
    try{
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'File',
          accept: { [blob.type]: ['.' + suggestedName.split('.').pop()] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }catch(err){ return false; }
  }

  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function canvasToBlob(){
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png', 1.0));
  }

  async function savePNG(){
    const blob = await canvasToBlob();
    const name = safeFilename('lavagna', 'png');
    const ok = await saveWithPicker(blob, name);
    if(!ok) downloadBlob(blob, name);
    toast('Immagine salvata');
  }

  function arrayBufferToBase64(buf){
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for(let i=0; i<bytes.length; i+=chunk){
      binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
    }
    return btoa(binary);
  }

  function base64ToBlob(b64, mime){
    const binary = atob(b64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for(let i=0;i<len;i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function saveProject(){
    const pngBlob = await canvasToBlob();
    const pngArrayBuf = await pngBlob.arrayBuffer();
    const b64 = arrayBufferToBase64(pngArrayBuf);

    const project = {
      v: 2,
      type: "lavagna-project",
      createdAt: new Date().toISOString(),
      bgColor,
      showGrid,
      width: logicalSize().w,
      height: logicalSize().h,
      pngBase64: b64,
      strokes
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const name = safeFilename('lavagna', 'lavagna.json');
    const ok = await saveWithPicker(blob, name);
    if(!ok) downloadBlob(blob, name);
    toast('Progetto salvato');
  }

  async function openProjectFile(){
    if(window.showOpenFilePicker){
      try{
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'Lavagna Project',
            accept: { 'application/json': ['.lavagna.json', '.json'] }
          }]
        });
        const file = await handle.getFile();
        loadProjectJSON(await file.text());
        return;
      }catch(e){}
    }
    fileInput.accept = ".lavagna.json,application/json";
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if(!f) return;
      loadProjectJSON(await f.text());
      fileInput.value = '';
    };
    fileInput.click();
  }

  function loadProjectJSON(text){
    let obj;
    try{ obj = JSON.parse(text); }catch(e){ toast('File non valido'); return; }
    if(!obj || obj.type !== 'lavagna-project' || !obj.pngBase64){
      toast('Progetto non riconosciuto'); return;
    }
    bgColor = obj.bgColor || '#ffffff';
    bgInput.value = bgColor;
    showGrid = !!obj.showGrid;
    btnGrid.classList.toggle('selected', showGrid);

    const blob = base64ToBlob(obj.pngBase64, 'image/png');
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(img, 0, 0, logicalSize().w, logicalSize().h);
      ctx.restore();
      if(showGrid) renderGrid();
      URL.revokeObjectURL(url);
      toast('Progetto caricato');
      history.length = 0; redoStack.length = 0; updateUndoRedo();
      strokes.length = 0;
      if(Array.isArray(obj.strokes)) strokes.push(...obj.strokes);
    };
    img.src = url;
  }

  async function importImage(){
    if(window.showOpenFilePicker){
      try{
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: 'Immagini', accept: { 'image/*': ['.png','.jpg','.jpeg','.webp'] } }]
        });
        const file = await handle.getFile();
        await placeImageFile(file);
        return;
      }catch(e){}
    }
    fileInput.accept = "image/*";
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if(!f) return;
      await placeImageFile(f);
      fileInput.value = '';
    };
    fileInput.click();
  }

  async function placeImageFile(file){
    snapshot();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { w: cw, h: ch } = logicalSize();
      const scale = Math.min(cw / img.width, ch / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (cw - w)/2;
      const y = (ch - h)/2;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      if(showGrid) renderGrid();
      URL.revokeObjectURL(url);
      toast('Immagine importata');
    };
    img.src = url;
  }

  sizeInput.addEventListener('input', () => {
    baseSize = Number(sizeInput.value);
    sizeVal.textContent = String(baseSize);
  });

  colorInput.addEventListener('input', () => setPenColor(colorInput.value));
  document.querySelectorAll('.chip').forEach(btn => btn.addEventListener('click', () => setPenColor(btn.dataset.color)));

  bgInput.addEventListener('input', () => {
    snapshot();
    bgColor = bgInput.value;
    // Keep current pixels on top after repainting background
    const current = canvas.toDataURL('image/png');
    drawBackground();
    restoreFromDataUrl(current);
    toast('Sfondo aggiornato');
  });

  btnGrid.addEventListener('click', () => {
    showGrid = !showGrid;
    btnGrid.classList.toggle('selected', showGrid);
    snapshot();
    if(showGrid) renderGrid();
    toast(showGrid ? 'Griglia ON' : 'Griglia OFF');
  });

  toolPen.addEventListener('click', () => setTool('pen'));
  toolEraser.addEventListener('click', () => setTool('eraser'));

  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnClear.addEventListener('click', clearBoard);

  btnFullscreen.addEventListener('click', async () => {
    const elem = document.documentElement;
    if(!document.fullscreenElement){
      try{ await elem.requestFullscreen(); }catch(e){}
    }else{
      try{ await document.exitFullscreen(); }catch(e){}
    }
  });

  btnSavePng.addEventListener('click', savePNG);
  btnSaveProject.addEventListener('click', saveProject);
  btnOpenProject.addEventListener('click', openProjectFile);
  btnImportImage.addEventListener('click', importImage);

  canvas.addEventListener('pointerdown', (evt) => { evt.preventDefault(); beginDraw(evt); }, { passive: false });
  canvas.addEventListener('pointermove', (evt) => { if(!drawing) return; evt.preventDefault(); extendDraw(evt); }, { passive: false });
  canvas.addEventListener('pointerup',   (evt) => { evt.preventDefault(); endDraw(); }, { passive: false });
  canvas.addEventListener('pointercancel', () => endDraw(), { passive: true });

  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

  function init(){
    sizeVal.textContent = String(baseSize);
    setTool('pen');
    resizeCanvas();
    drawBackground();
    updateUndoRedo();
    toast('Pronta');
  }

  window.addEventListener('resize', () => {
    clearTimeout(window._rz);
    window._rz = setTimeout(resizeCanvas, 80);
  });

  init();
})();