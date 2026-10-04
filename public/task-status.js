(function exposeTaskStatus(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TaskStatus = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  function scorePercent(task) {
    const match = String(task.score || '').match(/^\s*(\d+(?:\.\d+)?)\s*%/);
    return match ? Number(match[1]) : null;
  }

  function completionStatus(task, options = {}) {
    if (task.doneOverride === true || task.doneOverride === false) {
      return { complete: task.doneOverride, source: 'manual' };
    }
    const fullCredit = scorePercent(task) >= 100;
    if (options.requireManualCompletion && (fullCredit || task.sourceComplete === true)) {
      return { complete: null, source: 'confirmation_required' };
    }
    if (task.sourceComplete === true) return { complete: true, source: 'website' };
    if (fullCredit) return { complete: true, source: 'score' };
    if (task.sourceComplete === false) return { complete: false, source: 'website' };
    return { complete: null, source: 'unknown' };
  }

  function isComplete(task, options = {}) {
    return completionStatus(task, options).complete === true;
  }

  function effectiveDue(task) {
    return task.deadlineOverride || task.dueAt || null;
  }

  function categoryOf(task, now = Date.now(), options = {}) {
    const completion = completionStatus(task, options);
    if (completion.complete === true) return 'done';
    if (completion.source === 'confirmation_required') return 'pending';
    if (task.sourceStatus === 'future' && !task.deadlineOverride) return 'future';
    if (task.sourceStatus === 'past_due' && !task.deadlineOverride) return 'history';
    const due = effectiveDue(task);
    const dueTime = due ? new Date(due).getTime() : NaN;
    return Number.isFinite(dueTime) && dueTime < Number(now) ? 'history' : 'pending';
  }

  function needsAttention(task, now = Date.now(), options = {}) {
    const category = categoryOf(task, now, options);
    return category === 'pending' || category === 'history';
  }

  return { scorePercent, completionStatus, isComplete, effectiveDue, categoryOf, needsAttention };
});
