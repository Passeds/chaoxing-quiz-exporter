// Injected into the Chaoxing tab when the toolbar icon is clicked.
// Renders the panel as a draggable floating window so collecting, exporting and
// downloading never navigates away from the page being read.
(() => {
  const HOST_ID = 'cxqk-panel-host';
  const GAP = 8;

  // Clicking the icon again closes the panel; a new click mounts a fresh one.
  const previous = document.getElementById(HOST_ID);
  if (previous) {
    previous.remove();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .wrap{
        position:fixed;left:auto;right:16px;top:16px;
        display:flex;flex-direction:column;overflow:hidden;
        width:420px;height:78vh;
        background:#fff;border:1px solid rgba(18,26,22,.10);border-radius:12px;
        box-shadow:0 18px 48px -18px rgba(12,24,18,.30),0 2px 6px rgba(12,24,18,.05);
        font:13px/1.55 system-ui,-apple-system,"Segoe UI Variable","Segoe UI","Microsoft YaHei",sans-serif;
        color:#141a17;pointer-events:auto;
        transition:box-shadow .16s ease;
      }
      .wrap.dragging{box-shadow:0 26px 60px -20px rgba(12,24,18,.38),0 3px 10px rgba(12,24,18,.08)}
      .bar{
        flex:0 0 auto;display:flex;align-items:center;gap:8px;height:38px;padding:0 5px 0 11px;
        background:#fff;border-bottom:1px solid #eef1ef;
        cursor:grab;user-select:none;touch-action:none;
      }
      .wrap.dragging .bar{cursor:grabbing}
      .grip{
        flex:0 0 auto;width:12px;height:12px;opacity:.9;
        background-image:radial-gradient(#ccd6d1 1px,transparent 1.1px);background-size:3.5px 3.5px;
      }
      .ttl{font-size:12.5px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
      .ver{font-size:10px;font-weight:400;color:#9aa49f;letter-spacing:.02em;white-space:nowrap}
      .spacer{flex:1 1 auto}
      .icon{
        width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:#6d7873;
        font:inherit;font-size:12px;line-height:1;cursor:pointer;display:grid;place-items:center;
        transition:background .13s ease,color .13s ease;
      }
      .icon:hover{background:#f2f5f3;color:#141a17}
      .icon[data-act="close"]:hover{background:#fbeeeb;color:#9c3b25}
      .icon:focus-visible{outline:2px solid #146c53;outline-offset:1px}
      .frame{flex:1 1 auto;width:100%;border:0;display:block;background:#fff}
      .wrap.collapsed{height:auto!important}
      .wrap.collapsed .frame{display:none}
      @media (max-width:520px){
        .wrap{width:calc(100vw - 16px)}
        .bar{height:44px}
        .icon{width:30px;height:30px;font-size:13px}
      }
    </style>
    <div class="wrap" role="dialog" aria-label="学习通题库整理">
      <div class="bar">
        <span class="grip" aria-hidden="true"></span>
        <strong class="ttl">题库整理</strong>
        <span class="ver"></span>
        <span class="spacer"></span>
        <button class="icon" type="button" data-act="open" title="在标签页打开">↗</button>
        <button class="icon" type="button" data-act="min" title="收起">–</button>
        <button class="icon" type="button" data-act="close" title="关闭">✕</button>
      </div>
      <iframe class="frame" title="题库整理面板" allow="clipboard-write; clipboard-read"></iframe>
    </div>`;

  const wrap = root.querySelector('.wrap');
  const bar = root.querySelector('.bar');
  const frame = root.querySelector('.frame');
  const minBtn = root.querySelector('[data-act="min"]');
  const openBtn = root.querySelector('[data-act="open"]');
  const closeBtn = root.querySelector('[data-act="close"]');
  const verEl = root.querySelector('.ver');

  try {
    verEl.textContent = 'v' + chrome.runtime.getManifest().version;
  } catch {}

  document.documentElement.appendChild(host);

  function setPos(left, top) {
    wrap.style.left = left + 'px';
    wrap.style.top = top + 'px';
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  function clampPos() {
    const r = wrap.getBoundingClientRect();
    if (!r.width) return;
    const maxLeft = Math.max(GAP, window.innerWidth - r.width - GAP);
    const maxTop = Math.max(GAP, window.innerHeight - r.height - GAP);
    setPos(Math.min(Math.max(GAP, r.left), maxLeft), Math.min(Math.max(GAP, r.top), maxTop));
  }

  function sizeToViewport() {
    const width = Math.min(420, window.innerWidth - GAP * 2);
    const height = Math.min(Math.round(window.innerHeight * 0.78), 760);
    wrap.style.width = width + 'px';
    wrap.style.height = wrap.classList.contains('collapsed') ? 'auto' : height + 'px';
  }

  function savePos() {
    const r = wrap.getBoundingClientRect();
    try {
      chrome.storage.local.set({overlayPos: {left: Math.round(r.left), top: Math.round(r.top)}});
    } catch {}
  }

  // Initial placement: remembered position when it still fits, otherwise top-right,
  // and a bottom sheet on narrow viewports so the panel never runs off screen.
  sizeToViewport();
  const initial = wrap.getBoundingClientRect();
  if (window.innerWidth <= 520) {
    setPos(GAP, Math.max(GAP, window.innerHeight - initial.height - GAP));
  } else {
    setPos(Math.max(GAP, window.innerWidth - initial.width - 18), 18);
  }
  (async () => {
    try {
      const saved = (await chrome.storage.local.get('overlayPos')).overlayPos;
      if (saved && Number.isFinite(saved.left) && window.innerWidth > 520) {
        setPos(saved.left, saved.top);
        clampPos();
      }
    } catch {}
  })();

  let dragging = false, startX = 0, startY = 0, originX = 0, originY = 0;

  bar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const r = wrap.getBoundingClientRect();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    originX = r.left;
    originY = r.top;
    setPos(originX, originY);
    wrap.classList.add('dragging');
    try { bar.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  bar.addEventListener('pointermove', e => {
    if (!dragging) return;
    const r = wrap.getBoundingClientRect();
    const maxLeft = Math.max(GAP, window.innerWidth - r.width - GAP);
    const maxTop = Math.max(GAP, window.innerHeight - r.height - GAP);
    const left = Math.min(Math.max(GAP, originX + e.clientX - startX), maxLeft);
    const top = Math.min(Math.max(GAP, originY + e.clientY - startY), maxTop);
    setPos(left, top);
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('dragging');
    try { bar.releasePointerCapture(e.pointerId); } catch {}
    savePos();
  }
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  minBtn.addEventListener('click', () => {
    const collapsed = wrap.classList.toggle('collapsed');
    minBtn.textContent = collapsed ? '▢' : '–';
    minBtn.title = collapsed ? '展开' : '收起';
    wrap.style.height = collapsed ? 'auto' : Math.min(Math.round(window.innerHeight * 0.78), 760) + 'px';
    clampPos();
  });

  closeBtn.addEventListener('click', () => host.remove());

  // Same panel in a normal tab, for pages that refuse to embed it.
  openBtn.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({type: 'cxqk-open-tab'});
      host.remove();
    } catch {}
  });

  window.addEventListener('resize', () => {
    sizeToViewport();
    clampPos();
  });

  // The panel is an extension page, so it needs the id of the tab it sits on to read it.
  (async () => {
    let tabId = 0;
    try {
      const res = await chrome.runtime.sendMessage({type: 'cxqk-whoami'});
      tabId = (res && res.tabId) || 0;
    } catch {}
    frame.src = chrome.runtime.getURL('dashboard.html') + '?embed=1' + (tabId ? '&tab=' + tabId : '');
  })();
})();
