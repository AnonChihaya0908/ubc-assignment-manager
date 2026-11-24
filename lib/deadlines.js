const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3],
  ['may', 4], ['jun', 5], ['jul', 6], ['aug', 7],
  ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);
const { scorePercent, completionStatus, isComplete, effectiveDue, categoryOf, needsAttention } = require('../public/task-status');

function courseYear(courseTitle) {
  const match = String(courseTitle).match(/\b(20\d{2})W([12])\b/i);
  if (!match) return null;
  return Number(match[1]) + (match[2] === '2' ? 1 : 0);
}

function parseDisplayedDeadline(text, title, now = new Date()) {
  const source = String(text || '');
  // PrairieLearn displays the end of the current credit window, not always the final submission cutoff.
  const prefix = source.match(/(\d{1,3})\s*%\s+until\s+/i);
  if (!prefix) return { dueAt: null, creditPercent: null, deadlineKind: null };
  const creditPercent = Number(prefix[1]);
  if (creditPercent > 100) return { dueAt: null, creditPercent: null, deadlineKind: null };
  const deadline = source.slice(prefix.index + prefix[0].length).trim();
  const weekday = '(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+)?';
  const monthName = '(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?';
  const datePattern = `${weekday}${monthName}\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?`;
  const clock = '(\\d{1,2}):(\\d{2})\\s*(am|pm)?';
  const oldFormat = deadline.match(new RegExp(`^${clock},?\\s+${datePattern}`, 'i'));
  const newFormat = oldFormat ? null : deadline.match(new RegExp(`^${datePattern},?\\s+(end of day|${clock})\\b`, 'i'));
  if (!oldFormat && !newFormat) return { dueAt: null, creditPercent, deadlineKind: null };
  const month = MONTHS.get((oldFormat ? oldFormat[4] : newFormat[1]).toLowerCase());
  const day = Number(oldFormat ? oldFormat[5] : newFormat[2]);
  const yearText = oldFormat ? oldFormat[6] : newFormat[3];
  const endOfDay = Boolean(newFormat && /^end of day$/i.test(newFormat[4]));
  const hourText = oldFormat ? oldFormat[1] : newFormat[5];
  const minuteText = oldFormat ? oldFormat[2] : newFormat[6];
  const ampm = oldFormat ? oldFormat[3] : newFormat[7];
  let hour = endOfDay ? 23 : Number(hourText);
  const minute = endOfDay ? 59 : Number(minuteText);
  if (ampm) {
    if (hour < 1 || hour > 12) return { dueAt: null, creditPercent, deadlineKind: null };
    hour = hour % 12 + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return { dueAt: null, creditPercent, deadlineKind: null };

  const explicitYear = yearText ? Number(yearText) : courseYear(title);
  const years = explicitYear === null
    ? [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]
    : [explicitYear];
  const candidates = years.map(year => new Date(year, month, day, hour, minute));
  const valid = candidates.filter(date => date.getMonth() === month && date.getDate() === day);
  if (!valid.length) return { dueAt: null, creditPercent, deadlineKind: null };
  const date = valid.reduce((best, next) =>
    Math.abs(next.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime()) ? next : best);

  return {
    dueAt: date.toISOString(),
    creditPercent,
    deadlineKind: creditPercent === 100 ? 'on_time' : 'credit_window',
  };
}

module.exports = { parseDisplayedDeadline, scorePercent, effectiveDue, completionStatus, isComplete, categoryOf, needsAttention };
