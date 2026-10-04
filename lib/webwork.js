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

module.exports = { parseWebworkDate, parseWebworkText };
