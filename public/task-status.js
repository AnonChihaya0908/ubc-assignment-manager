(function exposeTaskStatus(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaskStatus = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function completionStatus(task) {
    if (task.doneOverride === true || task.doneOverride === false) {
      return { complete: task.doneOverride, source: 'manual' };
    }
    if (task.sourceComplete === true || task.sourceComplete === false) {
      return { complete: task.sourceComplete, source: 'website' };
    }
    return { complete: null, source: 'unknown' };
  }

  function isComplete(task) {
    return completionStatus(task).complete === true;
  }

  function effectiveDue(task) {
    return task.deadlineOverride || task.dueAt || null;
  }

  function categoryOf(task, now = Date.now()) {
    if (isComplete(task)) return 'done';
    if (task.sourceStatus === 'future' && !task.deadlineOverride) return 'future';
    if (task.sourceStatus === 'past_due' && !task.deadlineOverride) return 'history';
    const due = effectiveDue(task);
    const dueTime = due ? new Date(due).getTime() : NaN;
    return Number.isFinite(dueTime) && dueTime < Number(now) ? 'history' : 'pending';
  }

  function needsAttention(task, now = Date.now()) {
    const category = categoryOf(task, now);
    return category === 'pending' || category === 'history';
  }

  return { completionStatus, isComplete, effectiveDue, categoryOf, needsAttention };
});
