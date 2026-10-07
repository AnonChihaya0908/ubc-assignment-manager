const crypto = require('node:crypto');

class NativeBrowserBridge {
  constructor() {
    this.queue = [];
    this.pending = new Map();
    this.mode = 'stopped';
  }

  request(action, payload = {}, signal, timeoutMs = 30_000) {
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('操作已取消。'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (error, value) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        signal?.removeEventListener('abort', entry.cancel);
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => finish(signal.reason || new Error('操作已取消。'));
      const timer = setTimeout(() => finish(new Error('内置浏览器响应超时。')), timeoutMs);
      this.pending.set(id, { finish, cancel, timer });
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push({ id, action, ...payload });
    });
  }

  next() {
    while (this.queue.length) {
      const command = this.queue.shift();
      if (this.pending.has(command.id)) return command;
    }
    return null;
  }

  complete(id, result, error) {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.finish(error ? new Error(String(error)) : null, result);
    return true;
  }
}

module.exports = { NativeBrowserBridge };
