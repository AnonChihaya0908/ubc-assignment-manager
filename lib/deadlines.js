const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3],
  ['may', 4], ['jun', 5], ['jul', 6], ['aug', 7],
  ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);

function courseYear(courseTitle) {
  const match = String(courseTitle).match(/\b(20\d{2})W([12])\b/i);
  if (!match) return null;
  return Number(match[1]) + (match[2] === '2' ? 1 : 0);
}

function parseDisplayedDeadline(text, title, now = new Date()) {
  const source = String(text || '');
  // PrairieLearn displays the end of the current credit window, not always the final submission cutoff.
  const match = source.match(/(\d{1,3})\s*%\s+until\s+(\d{1,2}):(\d{2}),?\s+(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?/i);
  if (!match) return { dueAt: null, creditPercent: null, deadlineKind: null };

  const creditPercent = Number(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const month = MONTHS.get(match[4].toLowerCase());
  const day = Number(match[5]);
  if (hour > 23 || minute > 59) return { dueAt: null, creditPercent, deadlineKind: null };

  const explicitYear = match[6] ? Number(match[6]) : courseYear(title);
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

function isAutoComplete(score) {
  return /^100(?:\.0+)?%$/.test(String(score || '').trim());
}

function effectiveDue(task) {
  return task.deadlineOverride || task.dueAt || null;
}

function isComplete(task) {
  return task.doneOverride === null || task.doneOverride === undefined
    ? isAutoComplete(task.score)
    : Boolean(task.doneOverride);
}

module.exports = { parseDisplayedDeadline, isAutoComplete, effectiveDue, isComplete };
