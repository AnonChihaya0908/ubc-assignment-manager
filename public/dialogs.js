(() => {
  const dialog = document.getElementById('app-dialog');
  const levelLabel = document.getElementById('app-dialog-level');
  const title = document.getElementById('app-dialog-title');
  const body = document.getElementById('app-dialog-body');
  const items = document.getElementById('app-dialog-items');
  const choices = document.getElementById('app-dialog-choices');
  const error = document.getElementById('app-dialog-error');
  const actions = document.getElementById('app-dialog-actions');
  const queue = [];
  const pending = new Map();
  const completed = new Map();
  let active = null;
  let previousFocus = null;

  const levelNames = { info: '应用通知', warning: '需要注意', critical: '重要确认' };
  const buttonClasses = { primary: 'primary-button', secondary: 'secondary-button', danger: 'danger-button', text: 'text-button' };

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function normalized(config) {
    if (!config || typeof config.id !== 'string' || !config.id.trim()) throw new Error('弹窗通知必须包含 ID。');
    const level = Object.hasOwn(levelNames, config.level) ? config.level : 'info';
    const noticeActions = Array.isArray(config.actions) && config.actions.length ? config.actions : [
      { id: 'confirm', label: '知道了', kind: 'primary' },
    ];
    return {
      ...config,
      id: config.id.trim(),
      level,
      title: String(config.title || levelNames[level]),
      body: String(config.body || ''),
      items: Array.isArray(config.items) ? config.items.map(value => String(value)) : [],
      choices: Array.isArray(config.choices) ? config.choices.filter(choice => choice && typeof choice.id === 'string') : [],
      actions: noticeActions.map(action => ({
        id: String(action.id || 'confirm'), label: String(action.label || '确认'),
        kind: Object.hasOwn(buttonClasses, action.kind) ? action.kind : 'secondary', handler: action.handler,
      })),
      required: Boolean(config.required),
      repeat: Boolean(config.repeat),
    };
  }

  function selectedIds() {
    return [...choices.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  }

  function setBusy(busy, label) {
    for (const button of actions.querySelectorAll('button')) button.disabled = busy;
    for (const input of choices.querySelectorAll('input')) input.disabled = busy;
    dialog.setAttribute('aria-busy', String(busy));
    if (busy && label) label.textContent = '处理中…';
  }

  function finish(result) {
    if (!active) return;
    const entry = active;
    active = null;
    pending.delete(entry.config.id);
    if (!entry.config.repeat) completed.set(entry.config.id, result);
    if (dialog.open) dialog.close();
    entry.resolve(result);
    const focusTarget = previousFocus;
    previousFocus = null;
    if (focusTarget?.isConnected) focusTarget.focus();
    setTimeout(showNext, 0);
  }

  async function runAction(action, button) {
    if (!active) return;
    const result = { action: action.id, selectedIds: selectedIds() };
    error.hidden = true;
    const originalLabel = button.textContent;
    setBusy(true, button);
    try {
      const keepOpen = typeof action.handler === 'function' ? await action.handler(result) : undefined;
      if (keepOpen === false) {
        button.textContent = originalLabel;
        setBusy(false);
        return;
      }
      finish(result);
    } catch (actionError) {
      error.textContent = actionError?.message || '操作失败，请重试。';
      error.hidden = false;
      button.textContent = originalLabel;
      setBusy(false);
    }
  }

  function render(entry) {
    const config = entry.config;
    dialog.setAttribute('aria-busy', 'false');
    dialog.dataset.level = config.level;
    dialog.dataset.noticeId = config.id;
    levelLabel.textContent = levelNames[config.level];
    title.textContent = config.title;
    body.textContent = config.body;
    body.hidden = !config.body;
    items.replaceChildren(...config.items.map(value => make('li', '', value)));
    items.hidden = !config.items.length;
    choices.replaceChildren();
    choices.hidden = !config.choices.length;
    for (const choice of config.choices) {
      const label = make('label', 'app-dialog-choice');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = choice.id;
      input.checked = Boolean(choice.checked);
      const copy = make('span', 'app-dialog-choice-copy');
      const choiceName = make('strong', '', String(choice.label || choice.id));
      choiceName.dataset.i18nSkip = '';
      copy.append(choiceName);
      if (choice.description) copy.append(make('small', '', String(choice.description)));
      label.append(input, copy);
      choices.append(label);
    }
    error.hidden = true;
    error.textContent = '';
    actions.replaceChildren();
    for (const action of config.actions) {
      const button = make('button', buttonClasses[action.kind], action.label);
      button.type = 'button';
      button.dataset.action = action.id;
      button.addEventListener('click', () => runAction(action, button));
      actions.append(button);
    }
  }

  function showNext() {
    if (active || !queue.length) return;
    if ([...document.querySelectorAll('dialog[open]')].some(element => element !== dialog)) {
      setTimeout(showNext, 50);
      return;
    }
    active = queue.shift();
    previousFocus = document.activeElement;
    render(active);
    dialog.showModal();
    const target = choices.querySelector('input') || actions.querySelector('.primary-button,.danger-button,button');
    target?.focus();
  }

  function push(rawConfig) {
    const config = normalized(rawConfig);
    if (pending.has(config.id)) return pending.get(config.id).promise;
    if (!config.repeat && completed.has(config.id)) return Promise.resolve(completed.get(config.id));
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const entry = { config, resolve, promise };
    pending.set(config.id, entry);
    queue.push(entry);
    showNext();
    return promise;
  }

  dialog.addEventListener('cancel', event => {
    if (!active) return;
    event.preventDefault();
    if (!active.config.required) finish({ action: 'dismiss', selectedIds: selectedIds() });
  });
  dialog.addEventListener('click', event => {
    if (!active || active.config.required || event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outside) finish({ action: 'dismiss', selectedIds: selectedIds() });
  });

  window.AppDialog = { push };
})();
