/* ====== Local Visual Pick/Edit Tool ====== */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '']);
const EDITABLE_PROPS = [
  ['width', '宽度'],
  ['height', '高度'],
  ['marginTop', '上外距'],
  ['marginRight', '右外距'],
  ['marginBottom', '下外距'],
  ['marginLeft', '左外距'],
  ['paddingTop', '上内距'],
  ['paddingRight', '右内距'],
  ['paddingBottom', '下内距'],
  ['paddingLeft', '左内距'],
  ['gap', '间距'],
  ['borderRadius', '圆角'],
  ['fontSize', '字号']
];

if (LOCAL_HOSTS.has(location.hostname) && new URLSearchParams(location.search).has('devtool')) {
  initVisualDevtool();
}

function initVisualDevtool() {
  const root = document.createElement('div');
  root.className = 'rb-devtool';
  root.innerHTML = `
    <div class="rb-devtool-bar">
      <button class="rb-devtool-toggle" type="button">选元素</button>
    </div>
    <div class="rb-devtool-toast" role="status"></div>
    <section class="rb-devtool-panel" hidden>
      <div class="rb-devtool-head">
        <div class="rb-devtool-title">元素编辑</div>
        <button class="rb-devtool-close" type="button" title="关闭">×</button>
      </div>
      <div class="rb-devtool-body">
        <div class="rb-devtool-empty">点击“选元素”，移动鼠标高亮区域，再点击页面元素锁定。锁定后可以直接改宽高和间距。</div>
      </div>
    </section>
  `;

  const hoverBox = document.createElement('div');
  hoverBox.className = 'rb-devtool-overlay';
  const lockBox = document.createElement('div');
  lockBox.className = 'rb-devtool-overlay locked';
  document.body.append(root, hoverBox, lockBox);

  const toggle = root.querySelector('.rb-devtool-toggle');
  const panel = root.querySelector('.rb-devtool-panel');
  const panelBody = root.querySelector('.rb-devtool-body');
  const close = root.querySelector('.rb-devtool-close');
  const toast = root.querySelector('.rb-devtool-toast');
  const state = {
    active: false,
    locked: null,
    touched: new Set()
  };

  toggle.addEventListener('click', () => {
    setActive(!state.active);
    panel.hidden = false;
  });

  close.addEventListener('click', () => {
    setActive(false);
    panel.hidden = true;
    state.locked = null;
    hideBox(lockBox);
    renderEmpty();
  });

  root.addEventListener('input', event => {
    const input = event.target.closest('[data-style-prop]');
    if (!input || !state.locked) return;
    const prop = input.dataset.styleProp;
    const raw = input.value.trim();
    state.touched.add(prop);
    state.locked.style[prop] = raw === '' ? '' : `${Number(raw)}px`;
    renderLockBox();
  });

  root.addEventListener('click', event => {
    const action = event.target.closest('[data-dev-action]')?.dataset.devAction;
    if (!action) return;
    if (action === 'copy-context') copyText(buildContext(), '已复制定位上下文');
    if (action === 'copy-css') copyText(buildCss(), '已复制 CSS');
    if (action === 'reset-inline') resetInline();
  });

  document.addEventListener('pointermove', event => {
    if (!state.active) return;
    const target = pickTarget(event.target);
    if (!target) {
      hideBox(hoverBox);
      return;
    }
    drawBox(hoverBox, target);
  }, true);

  document.addEventListener('click', event => {
    if (!state.active) return;
    const target = pickTarget(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    state.locked = target;
    state.touched.clear();
    panel.hidden = false;
    drawBox(lockBox, target);
    renderPanel(target);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setActive(false);
  });

  window.addEventListener('scroll', () => {
    if (state.locked) renderLockBox();
  }, true);
  window.addEventListener('resize', () => {
    if (state.locked) renderLockBox();
  });

  function setActive(active) {
    state.active = active;
    toggle.classList.toggle('active', active);
    toggle.textContent = active ? '选择中' : '选元素';
    document.body.classList.toggle('rb-devtool-picking', active);
    if (!active) hideBox(hoverBox);
  }

  function pickTarget(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest('.rb-devtool') || target.classList.contains('rb-devtool-overlay')) return null;
    if (target === document.documentElement || target === document.body) return null;
    return target;
  }

  function renderEmpty() {
    panelBody.innerHTML = '<div class="rb-devtool-empty">点击“选元素”，移动鼠标高亮区域，再点击页面元素锁定。锁定后可以直接改宽高和间距。</div>';
  }

  function renderPanel(el) {
    const rect = el.getBoundingClientRect();
    const styles = getComputedStyle(el);
    const controls = EDITABLE_PROPS.map(([prop, label]) => {
      const value = readPx(styles[prop]);
      return `
        <div class="rb-devtool-field">
          <label>${label}</label>
          <input type="number" step="1" data-style-prop="${prop}" value="${value}">
        </div>
      `;
    }).join('');

    panelBody.innerHTML = `
      <div class="rb-devtool-kv">
        <b>selector</b><div class="rb-devtool-code">${escapeHtml(buildSelector(el))}</div>
        <b>class</b><div class="rb-devtool-code">${escapeHtml(classText(el) || '-')}</div>
        <b>尺寸</b><div>${Math.round(rect.width)} × ${Math.round(rect.height)} px</div>
        <b>display</b><div>${styles.display}</div>
      </div>
      <div class="rb-devtool-grid">${controls}</div>
      <div class="rb-devtool-actions">
        <button class="rb-devtool-mini-btn" type="button" data-dev-action="copy-context">复制上下文</button>
        <button class="rb-devtool-mini-btn" type="button" data-dev-action="copy-css">复制 CSS</button>
        <button class="rb-devtool-mini-btn wide" type="button" data-dev-action="reset-inline">清除本次内联修改</button>
      </div>
      <div class="rb-devtool-note">这里先实时写入 inline style，用来快速试尺寸。满意后复制 CSS 或上下文给我，我会落到对应源码 CSS。</div>
    `;
  }

  function resetInline() {
    if (!state.locked) return;
    state.touched.forEach(prop => {
      state.locked.style[prop] = '';
    });
    state.touched.clear();
    renderPanel(state.locked);
    renderLockBox();
    showToast('已清除');
  }

  function renderLockBox() {
    if (!state.locked || !state.locked.isConnected) {
      hideBox(lockBox);
      return;
    }
    drawBox(lockBox, state.locked);
  }

  function drawBox(box, el) {
    const rect = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${Math.round(rect.left)}px`;
    box.style.top = `${Math.round(rect.top)}px`;
    box.style.width = `${Math.round(rect.width)}px`;
    box.style.height = `${Math.round(rect.height)}px`;
  }

  function hideBox(box) {
    box.style.display = 'none';
  }

  function buildContext() {
    if (!state.locked) return '';
    const el = state.locked;
    const rect = el.getBoundingClientRect();
    const styles = getComputedStyle(el);
    return [
      '请修改这个元素：',
      `selector: ${buildSelector(el)}`,
      `class: ${classText(el) || '-'}`,
      `size: ${Math.round(rect.width)} x ${Math.round(rect.height)} px`,
      `display: ${styles.display}`,
      `margin: ${styles.marginTop} ${styles.marginRight} ${styles.marginBottom} ${styles.marginLeft}`,
      `padding: ${styles.paddingTop} ${styles.paddingRight} ${styles.paddingBottom} ${styles.paddingLeft}`,
      `border-radius: ${styles.borderRadius}`,
      `text: ${compactText(el.textContent)}`
    ].join('\n');
  }

  function buildCss() {
    if (!state.locked) return '';
    const selector = buildSelector(state.locked);
    const lines = EDITABLE_PROPS
      .map(([prop]) => [prop, state.locked.style[prop]])
      .filter(([, value]) => value)
      .map(([prop, value]) => `  ${toKebab(prop)}: ${value};`);
    if (!lines.length) return `${selector} {\n  /* 先在面板里调整一个值 */\n}`;
    return `${selector} {\n${lines.join('\n')}\n}`;
  }

  async function copyText(text, okMessage) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    showToast(okMessage);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 1200);
  }
}

function buildSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.body && parts.length < 4) {
    const tag = node.tagName.toLowerCase();
    const classes = [...node.classList]
      .filter(cls => !cls.startsWith('rb-devtool'))
      .slice(0, 3)
      .map(cls => `.${CSS.escape(cls)}`)
      .join('');
    let part = `${tag}${classes}`;
    if (!classes) {
      const index = [...node.parentElement.children].filter(child => child.tagName === node.tagName).indexOf(node) + 1;
      part += `:nth-of-type(${index})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function readPx(value) {
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? Math.round(num) : '';
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}

function compactText(value = '') {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120) || '-';
}

function classText(el) {
  if (!el) return '';
  if (typeof el.className === 'string') return el.className;
  return el.className?.baseVal || '';
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}
