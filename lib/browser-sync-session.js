function createBrowserSyncSession({ close, shouldClose, onCloseError = () => {} }) {
  let active = 0;
  let closing = null;

  return {
    get active() { return active > 0; },
    async run(action) {
      active += 1;
      try {
        if (closing) await closing;
        return await action();
      } finally {
        active -= 1;
        if (active === 0 && shouldClose()) {
          const pending = Promise.resolve().then(close).catch(onCloseError);
          closing = pending;
          try { await pending; }
          finally { if (closing === pending) closing = null; }
        }
      }
    },
  };
}

module.exports = { createBrowserSyncSession };
