const MONTHS = new Map([
  ['january', 0], ['february', 1], ['march', 2], ['april', 3],
  ['may', 4], ['june', 5], ['july', 6], ['august', 7],
  ['september', 8], ['october', 9], ['november', 10], ['december', 11],
]);

function parseWebworkDate(text) {
  const match = String(text || '').match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(20\d{2}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)\s*(PDT|PST)\b/i);
  if (!match) return null;
  const [, monthName, dayText, yearText, hourText, minuteText, secondText, ampm, zone] = match;
  const month = MONTHS.get(monthName.toLowerCase());
  const day = Number(dayText), year = Number(yearText), hour = Number(hourText);
  const minute = Number(minuteText), second = Number(secondText || 0);
  if (hour < 1 || hour > 12 || minute > 59 || second > 59) return null;
  const localHour = hour % 12 + (ampm.toUpperCase() === 'PM' ? 12 : 0);
  const local = new Date(Date.UTC(year, month, day, localHour, minute, second));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month || local.getUTCDate() !== day) return null;
  return new Date(local.getTime() + (zone.toUpperCase() === 'PDT' ? 7 : 8) * 3600000).toISOString();
}

function parseWebworkText(text, links = {}, pageUrl = '') {
  const lines = String(text || '').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rows = [];
  let section = '';
  let current = null;
  const flush = () => {
    if (current) rows.push(current);
    current = null;
  };
  for (const line of lines) {
    if (/^Open Assignments$/i.test(line)) { flush(); section = 'open'; continue; }
    if (/^Future Assignments$/i.test(line)) { flush(); section = 'future'; continue; }
    if (/^Past Due Assignments$/i.test(line)) { flush(); section = 'past_due'; continue; }
    if (!section) continue;
    const assignment = line.match(/^(Assignment-[\w-]+)\b(?:\s+(.*))?$/i);
    if (assignment) {
      flush();
      current = { name: assignment[1], code: assignment[1], section, url: links[assignment[1]] || pageUrl,
        dueText: '', openText: '' };
      if (assignment[2]) {
        const due = assignment[2].match(/\bDue\s+(.+)$/i);
        const opens = assignment[2].match(/\bWill open on\s+(.+)$/i);
        if (due) current.dueText = due[1];
        if (opens) current.openText = opens[1];
      }
      continue;
    }
    if (!current) continue;
    const due = line.match(/\bDue\s+(.+)$/i);
    const opens = line.match(/\bWill open on\s+(.+)$/i);
    if (due) current.dueText = due[1];
    if (opens) current.openText = opens[1];
  }
  flush();
  return rows;
}

function parseWebworkProgress(tables) {
  if (!Array.isArray(tables)) throw new Error('WeBWorK 作业详情页没有可读取的题目表格。');
  for (const table of tables) {
    const headers = Array.isArray(table?.headers) ? table.headers.map(value => String(value || '').trim().toLowerCase()) : [];
    const statusIndex = headers.indexOf('status');
    if (statusIndex < 0) continue;
    const worthIndex = headers.indexOf('worth');
    const problemRows = Array.isArray(table.rows) ? table.rows.filter(row => Array.isArray(row) && row[0] && row.length > statusIndex) : [];
    if (!problemRows.length) continue;
    const statuses = problemRows.map(row => {
      const match = String(row[statusIndex] || '').match(/(\d+(?:\.\d+)?)\s*%/);
      return match ? Number(match[1]) : null;
    });
    if (statuses.some(value => value === null || value < 0 || value > 100)) {
      throw new Error('WeBWorK 作业详情页包含无法识别的题目完成度。');
    }
    const weights = problemRows.map(row => worthIndex < 0 ? null : Number(String(row[worthIndex] || '').trim()));
    const weighted = worthIndex >= 0 && weights.every(value => Number.isFinite(value) && value >= 0) && weights.some(value => value > 0);
    const score = weighted
      ? statuses.reduce((sum, value, index) => sum + value * weights[index], 0) / weights.reduce((sum, value) => sum + value, 0)
      : statuses.reduce((sum, value) => sum + value, 0) / statuses.length;
    const completedProblemCount = statuses.filter(value => value === 100).length;
    const rounded = Math.round(score * 10) / 10;
    return {
      score: `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`,
      sourceComplete: completedProblemCount === statuses.length,
      problemCount: statuses.length,
      completedProblemCount,
    };
  }
  throw new Error('WeBWorK 作业详情页没有识别到 Status 列。');
}

module.exports = { parseWebworkDate, parseWebworkText, parseWebworkProgress };
