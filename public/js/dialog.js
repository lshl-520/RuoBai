let activeDialog = null;

function buttonClass(variant = 'ghost') {
  if (variant === 'primary') return 'btn-soft';
  if (variant === 'danger') return 'btn-ghost danger-btn';
  return 'btn-ghost';
}

export function closeDialog() {
  if (!activeDialog) return;
  activeDialog.remove();
  activeDialog = null;
  document.body.classList.remove('rb-modal-open');
}

export function openDialog({
  title = '',
  content = '',
  actions = [],
  className = '',
  onMount = null,
  closeOnBackdrop = true
} = {}) {
  closeDialog();

  const root = document.createElement('div');
  root.className = 'rb-modal-backdrop';
  root.innerHTML = `
    <div class="rb-modal-shell">
      <section class="rb-modal glass ${className}">
        <header class="rb-modal-header">
          <h3>${title}</h3>
          <button type="button" class="rb-modal-close" aria-label="关闭">×</button>
        </header>
        <div class="rb-modal-body">${content}</div>
        <footer class="rb-modal-actions">
          ${actions.map((action, index) => `
            <button
              type="button"
              class="${buttonClass(action.variant)}"
              data-dialog-action="${index}"
            >${action.label}</button>
          `).join('')}
        </footer>
      </section>
    </div>
  `;

  root.addEventListener('click', event => {
    if (event.target === root && closeOnBackdrop) {
      closeDialog();
    }
  });

  root.querySelector('.rb-modal-close')?.addEventListener('click', () => {
    closeDialog();
  });

  root.querySelectorAll('[data-dialog-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = actions[Number(button.getAttribute('data-dialog-action'))];
      if (!action) return;
      const shouldClose = action.closeOnClick !== false;
      await action.onClick?.({ root, close: closeDialog });
      if (shouldClose) {
        closeDialog();
      }
    });
  });

  document.body.appendChild(root);
  document.body.classList.add('rb-modal-open');
  activeDialog = root;
  onMount?.(root, closeDialog);
  return root;
}
