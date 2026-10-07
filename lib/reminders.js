const { effectiveDue, categoryOf } = require('./deadlines');
const { normalizeLeadHours, inQuietHours } = require('./wechat');
const { courseAccessConfirmed } = require('./store');
const { localeFor, translateFor } = require('../public/i18n');

function pendingReminderEvents(state, config, now = new Date(), options = {}) {
  if (config.remindersPaused || inQuietHours(config, now)) return [];
  const nowMs = now.getTime();
  const disabled = new Set(config.disabledCourseIds || []);
  for (const course of state.courses) if (!courseAccessConfirmed(course)) disabled.add(course.id);
  const events = [];
  const locale = localeFor(state.preferences?.language);
  for (const task of state.tasks) {
    if (disabled.has(task.courseId)) continue;
    if (categoryOf(task, nowMs, options) !== 'pending' ||
        (task.deadlineKind === 'credit_window' && !task.deadlineOverride)) continue;
    const due = effectiveDue(task);
    if (!due) continue;
    const remaining = new Date(due).getTime() - nowMs;
    if (!(remaining > 0)) continue;
    for (const hours of normalizeLeadHours(config.leadHours)) {
      if (remaining > hours * 3_600_000) continue;
      const key = `${task.id}:${due}:${hours}h`;
      if (state.notified?.[key]) continue;
      const title = translateFor(`${task.name} · ${hours} 小时内截止`, locale);
      const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(due));
      events.push({ key, taskId: task.id, title,
        message: `${task.code || task.section || translateFor('作业', locale)} · ${date}` });
    }
  }
  return events;
}

module.exports = { pendingReminderEvents };
