(() => {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  // UI
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

  // State
  let devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
  let bgColor = bgInput.value;
  let showGrid = false;

  let tool = 'pen'; // 'pen' | 'eraser'
  let penColor = colorInput.value;
  let baseSize = Number(sizeInput.value);

  // Drawing state (strokes recorded for project save)
  const strokes = []; // {tool, color, baseSize, points:[{x,y,p,t}]}
  let currentStroke = null;
  let drawing = false;

  // Undo/redo via snapshots to keep it fast and robust
  const history = [];
  const redoStack = [];
  const HISTORY_LIMIT = 40;

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

  // Canvas sizing
  function resizeCanvas(){
    const rect = canvas.getBoundingClientRect();
    devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);

    // preserve current pixels
    const prev = document.createElement('canvas');
    prev.width = canvas.width;
    prev.height = canvas.height;
    prev.getContext('2d').drawImage(canvas, 0, 0);

    canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));

    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.imageSmoothingEnabled = true;

    // redraw background + previous content scaled
    drawBackground();
    if(prev.width && prev.height){
      ctx.drawImage(prev, 0, 0, prev.width / devicePixelRatio, prev.height / devicePixelRatio);
    }

    renderGrid();
  }

  function drawBackground(){
    ctx.save();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
    ctx.restore();
  }

  function renderGrid(){
    if(!showGrid) return;
    const w = canvas.width / devicePixelRatio;
    const h = canvas.height / devicePixelRatio;
    ctx.save();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.globalAlpha = 0.15;
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    const step = 32;
    ctx.beginPath();
    for(let x=0; x<=w; x+=step){
      ctx.moveTo(x+0.5, 0);
      ctx.lineTo(x+0.5, h);
    }
    for(let y=0; y<=h; y+=step){
      ctx.moveTo(0, y+0.5);
      ctx.lineTo(w, y+0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  function snapshot(){
    try{
      const dataUrl = canvas.toDataURL('image/png');
      history.push(dataUrl);
      if(history.length > HISTORY_LIMIT) history.shift();
      redoStack.length = 0;
      updateUndoRedo();
    }catch(e){
      console.warn('snapshot failed', e);
    }
  }

  function updateUndoRedo(){
    btnUndo.disabled = history.length === 0;
    btnRedo.disabled = redoStack.length === 0;
  }

  function restoreFromDataUrl(dataUrl){
    const img = new Image();
    img.onload = () => {
      drawBackground();
      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
      ctx.restore();
      renderGrid();
    };
    img.src = dataUrl;
  }

  function undo(){
    if(history.length === 0) return;
    const last = history.pop();
    redoStack.push(canvas.toDataURL('image/png'));
    restoreFromDataUrl(last);
    updateUndoRedo();
    // remove strokes beyond snapshot boundary (approx): simplest = clear strokes when undo/redo used
    // to keep project consistent, we'll also snapshot strokes as pixels in project.
    // So strokes are still kept for "project save" as image; no need to sync.
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
    renderGrid();
    toast('Pulito');
  }

  // Pointer handling
  function getPoint(evt){
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    const p = (typeof evt.pressure === 'number' && evt.pressure > 0) ? evt.pressure : 0.5;
    return { x, y, p, t: performance.now() };
  }

  function beginStroke(pt){
    drawing = true;
    currentStroke = {
      tool,
      color: penColor,
      baseSize,
      points: [pt]
    };
    // Start drawing immediately
    drawSegment(null, pt, currentStroke);
  }

  function extendStroke(pt){
    if(!drawing || !currentStroke) return;
    const pts = currentStroke.points;
    const prev = pts[pts.length - 1];
    pts.push(pt);
    drawSegment(prev, pt, currentStroke);
  }

  function endStroke(){
    if(!drawing) return;
    drawing = false;
    if(currentStroke && currentStroke.points.length > 1){
      strokes.push(currentStroke);
      snapshot(); // snapshot after each stroke for undo
    }
    currentStroke = null;
  }

  function drawSegment(a, b, stroke){
    // Use small smoothing: quadratic to midpoints
    ctx.save();
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    const size = stroke.baseSize;
    // pressure multiplier: mild (avoid too aggressive)
    const w = Math.max(0.7, Math.min(2.2, b.p * 2.2)) * size;

    if(stroke.tool === 'eraser'){
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    }else{
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w;

    if(!a){
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + 0.01, b.y + 0.01);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(a.x, a.y, midX, midY);
    ctx.stroke();

    ctx.restore();
  }

  // Save helpers
  function safeFilename(prefix, ext){
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const name = `${prefix}-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
    return name;
  }

  async function saveWithPicker(blob, suggestedName){
    // File System Access API (Chrome/Edge/Android; Safari support varies)
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
    }catch(err){
      // User cancelled or not allowed
      return false;
    }
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
    return new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png', 1.0);
    });
  }

  async function savePNG(){
    const blob = await canvasToBlob();
    const name = safeFilename('lavagna', 'png');
    const ok = await saveWithPicker(blob, name);
    if(!ok) downloadBlob(blob, name);
    toast('Immagine salvata');
  }

  async function saveProject(){
    const pngBlob = await canvasToBlob();
    const pngArrayBuf = await pngBlob.arrayBuffer();
    const b64 = arrayBufferToBase64(pngArrayBuf);

    const project = {
      v: 1,
      type: "lavagna-project",
      createdAt: new Date().toISOString(),
      bgColor,
      showGrid,
      width: canvas.width / devicePixelRatio,
      height: canvas.height / devicePixelRatio,
      // pixel snapshot is the ground-truth (fast + compatible)
      pngBase64: b64,
      // strokes are optional (for future evolutions)
      strokes
    };

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const name = safeFilename('lavagna', 'lavagna.json');
    const ok = await saveWithPicker(blob, name);
    if(!ok) downloadBlob(blob, name);
    toast('Progetto salvato');
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

  async function openProjectFile(){
    // Prefer picker if available
    if(window.showOpenFilePicker){
      try{
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'Lavagna Project',
            accept: { 'application/json': ['.lavagna.json', '.json'] }
          }]
        });
        const file = await handle.getFile();
        const text = await file.text();
        loadProjectJSON(text);
        return;
      }catch(e){ /* cancel */ }
    }
    // Fallback input
    fileInput.accept = ".lavagna.json,application/json";
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if(!f) return;
      const text = await f.text();
      loadProjectJSON(text);
      fileInput.value = '';
    };
    fileInput.click();
  }

  function loadProjectJSON(text){
    let obj;
    try{
      obj = JSON.parse(text);
    }catch(e){
      toast('File non valido');
      return;
    }
    if(!obj || obj.type !== 'lavagna-project' || !obj.pngBase64){
      toast('Progetto non riconosciuto');
      return;
    }
    bgColor = obj.bgColor || '#ffffff';
    bgInput.value = bgColor;
    showGrid = !!obj.showGrid;
    btnGrid.classList.toggle('selected', showGrid);

    drawBackground();
    const blob = base64ToBlob(obj.pngBase64, 'image/png');
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.drawImage(img, 0, 0, canvas.width / devicePixelRatio, canvas.height / devicePixelRatio);
      ctx.restore();
      renderGrid();
      URL.revokeObjectURL(url);
      toast('Progetto caricato');
      history.length = 0;
      redoStack.length = 0;
      updateUndoRedo();
      // restore strokes if present
      strokes.length = 0;
      if(Array.isArray(obj.strokes)) strokes.push(...obj.strokes);
    };
    img.src = url;
  }

  async function importImage(){
    if(window.showOpenFilePicker){
      try{
        const [handle] = await window.showOpenFilePicker({
          types: [{
            description: 'Immagini',
            accept: { 'image/*': ['.png','.jpg','.jpeg','.webp'] }
          }]
        });
        const file = await handle.getFile();
        await placeImageFile(file);
        return;
      }catch(e){ /* cancel */ }
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
      // fit inside canvas, centered
      const cw = canvas.width / devicePixelRatio;
      const ch = canvas.height / devicePixelRatio;
      const scale = Math.min(cw / img.width, ch / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (cw - w)/2;
      const y = (ch - h)/2;

      ctx.save();
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      renderGrid();
      URL.revokeObjectURL(url);
      toast('Immagine importata');
    };
    img.src = url;
  }

  // Events
  sizeInput.addEventListener('input', () => {
    baseSize = Number(sizeInput.value);
    sizeVal.textContent = String(baseSize);
  });

  colorInput.addEventListener('input', () => setPenColor(colorInput.value));
  document.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => setPenColor(btn.dataset.color));
  });

  bgInput.addEventListener('input', () => {
    bgColor = bgInput.value;
    snapshot();
    // redraw background while preserving drawing pixels:
    const imgData = canvas.toDataURL('image/png');
    drawBackground();
    restoreFromDataUrl(imgData);
    toast('Sfondo aggiornato');
  });

  btnGrid.addEventListener('click', () => {
    showGrid = !showGrid;
    btnGrid.classList.toggle('selected', showGrid);
    snapshot();
    // Re-render: background already includes drawing, just overlay grid
    const imgData = canvas.toDataURL('image/png');
    restoreFromDataUrl(imgData);
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

  // Pointer events for Apple Pencil + touch
  canvas.addEventListener('pointerdown', (evt) => {
    evt.preventDefault();
    canvas.setPointerCapture(evt.pointerId);
    const pt = getPoint(evt);
    beginStroke(pt);
  }, { passive: false });

  canvas.addEventListener('pointermove', (evt) => {
    if(!drawing) return;
    evt.preventDefault();
    const pt = getPoint(evt);
    extendStroke(pt);
  }, { passive: false });

  canvas.addEventListener('pointerup', (evt) => {
    evt.preventDefault();
    endStroke();
  }, { passive: false });

  canvas.addEventListener('pointercancel', () => endStroke());

  // Prevent scroll while drawing with touch
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // Init
  function init(){
    sizeVal.textContent = String(baseSize);
    setTool('pen');
    drawBackground();
    renderGrid();
    updateUndoRedo();
    resizeCanvas();
    // start with an empty snapshot baseline (so first undo is disabled)
    history.length = 0;
    redoStack.length = 0;
    updateUndoRedo();
    toast('Pronta');
  }

  window.addEventListener('resize', () => {
    // debounce a bit
    clearTimeout(window._rz);
    window._rz = setTimeout(resizeCanvas, 80);
  });

  init();
})();