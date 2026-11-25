const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3],
  ['may', 4], ['jun', 5], ['jul', 6], ['aug', 7],
  ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);
const { scorePercent, completionStatus, isComplete, effectiveDue, categoryOf, needsAttention } = require('../public/task-status');

const RELATIVE_DAYS = { yesterday: -1, today: 0, tomorrow: 1 };
const RELATIVE_DAY = '(?<relativeDay>yesterday|today|tomorrow)\\b';
const ABSOLUTE_DAY = '(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\\s+)?' +
  '(?<month>Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?\\s+(?<day>\\d{1,2})(?:,?\\s+(?<year>20\\d{2}))?\\b';
const DAY = '(?:' + ABSOLUTE_DAY + '|' + RELATIVE_DAY + ')';
const CLOCK = '(?<hour>\\d{1,2})(?::(?<minute>\\d{2})(?::(?<second>\\d{2}))?)?' +
  '(?:\\s*(?<meridiem>am|pm))?(?=$|[\\s,()]|\\.(?=$|\\s))';
const RELATIVE_BOUNDARY = new RegExp('^(?<boundary>start|end)\\s+of\\s+' + RELATIVE_DAY, 'i');
const DATE_FIRST = new RegExp('^' + DAY + ',?\\s+(?:(?<boundary>start|end)\\s+of\\s+day\\b|' + CLOCK + ')', 'i');
const TIME_FIRST = new RegExp('^' + CLOCK + ',?\\s+' + DAY, 'i');

function courseYear(courseTitle) {
  const match = String(courseTitle).match(/\b(20\d{2})W([12])\b/i);
  if (!match) return null;
  return Number(match[1]) + (match[2] === '2' ? 1 : 0);
}

function deadlineClock({ hour, minute, second, meridiem, boundary }) {
  // PrairieLearn reserves "end of day" and its relative forms for 23:59:59.
  if (boundary) return boundary.toLowerCase() === 'end' ? [23, 59, 59] : [0, 0, 0];

  const hours = Number(hour);
  const minutes = Number(minute ?? 0);
  const seconds = Number(second ?? 0);
  if (minutes > 59 || seconds > 59) return null;
  if (!meridiem) return minute !== undefined && hours <= 23 ? [hours, minutes, seconds] : null;
  if (hours < 1 || hours > 12) return null;
  return [hours % 12 + (meridiem.toLowerCase() === 'pm' ? 12 : 0), minutes, seconds];
}

function deadlineDate(parts, title, now) {
  const clock = deadlineClock(parts);
  if (!clock || !Number.isFinite(now.getTime())) return null;
  if (parts.relativeDay) {
    const offset = RELATIVE_DAYS[parts.relativeDay.toLowerCase()];
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, ...clock);
  }

  const month = MONTHS.get(parts.month.toLowerCase());
  const day = Number(parts.day);
  const year = parts.year ? Number(parts.year) : courseYear(title);
  const years = year === null ? [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1] : [year];
  const dates = years.map(candidate => new Date(candidate, month, day, ...clock))
    .filter(date => date.getMonth() === month && date.getDate() === day);
  if (!dates.length) return null;
  return dates.reduce((best, next) =>
    Math.abs(next.getTime() - now.getTime()) < Math.abs(best.getTime() - now.getTime()) ? next : best);
}

function parseDisplayedDeadline(text, title, now = new Date()) {
  const source = String(text || '');
  // PrairieLearn displays the end of the current credit window, not always the final submission cutoff.
  const prefix = source.match(/(\d{1,3})\s*%\s+until\s+/i);
  if (!prefix) return { dueAt: null, creditPercent: null, deadlineKind: null };
  const creditPercent = Number(prefix[1]);
  if (creditPercent > 100) return { dueAt: null, creditPercent: null, deadlineKind: null };
  const deadline = source.slice(prefix.index + prefix[0].length).trim();
  const match = deadline.match(RELATIVE_BOUNDARY) || deadline.match(DATE_FIRST) || deadline.match(TIME_FIRST);
  const date = match && deadlineDate(match.groups, title, now);
  if (!date) return { dueAt: null, creditPercent, deadlineKind: null };

  return {
    dueAt: date.toISOString(),
    creditPercent,
    deadlineKind: creditPercent === 100 ? 'on_time' : 'credit_window',
  };
}

module.exports = { parseDisplayedDeadline, scorePercent, effectiveDue, completionStatus, isComplete, categoryOf, needsAttention };
