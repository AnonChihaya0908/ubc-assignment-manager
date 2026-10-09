const MONTHS = new Map([
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['may', 4], ['jun', 5],
  ['jul', 6], ['aug', 7], ['sep', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);

// Gradescope labels its dates with a timezone in the table heading. Do not
// interpret those clock times in the computer's timezone.
const TIMEZONE_OFFSETS = { PDT: -7, PST: -8, UTC: 0, GMT: 0, MDT: -6, MST: -7, CDT: -5, CST: -6, EDT: -4, EST: -5 };

function parseGradescopeDate(value, zone, courseTitle, now = new Date()) {
  const source = String(value || '');
  const iso = source.match(/\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})\b/);
  if (iso && Number.isFinite(Date.parse(iso[0]))) return new Date(iso[0]).toISOString();
  const match = source.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s+(20\d{2}))?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (!match) return null;
  const month = MONTHS.get(match[1].slice(0, 3).toLowerCase());
  const day = Number(match[2]), minute = Number(match[5]);
  const clockHour = Number(match[4]);
  if (clockHour < 1 || clockHour > 12 || minute > 59) return null;
  const hour = clockHour % 12 + (match[6].toUpperCase() === 'PM' ? 12 : 0);
  const term = String(courseTitle || '').match(/\b(20\d{2})W([12])\b/i);
  const fall = String(courseTitle || '').match(/\bFall\s+(20\d{2})\b/i);
  const year = match[3] ? Number(match[3]) : term
    ? Number(term[1]) + (term[2] === '2' && month < 6 ? 1 : 0)
    : fall ? Number(fall[1]) : now.getUTCFullYear();
  const offset = TIMEZONE_OFFSETS[String(zone || '').toUpperCase()];
  if (offset === undefined) return null;
  const utc = new Date(Date.UTC(year, month, day, hour - offset, minute));
  // Check in the source timezone so invalid days do not roll into another month.
  const local = new Date(utc.getTime() + offset * 3600000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month || local.getUTCDate() !== day) return null;
  return utc.toISOString();
}

function parseGradescopeStatus(value) {
  const status = String(value || '').replace(/\s+/g, ' ').trim();
  const grade = status.match(/(?:^|\s)(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?:\s|$)/);
  if (grade) {
    const earned = Number(grade[1]), possible = Number(grade[2]);
    return { sourceComplete: true, score: possible > 0 ? `${Math.round(earned / possible * 1000) / 10}%` : '', gradeText: `${grade[1]} / ${grade[2]}` };
  }
  if (/\bsubmitted\b|\bgraded\b/i.test(status) && !/no\s+submission/i.test(status)) {
    return { sourceComplete: true, score: '', gradeText: '' };
  }
  if (/no\s+submission|not\s+submitted/i.test(status)) {
    return { sourceComplete: false, score: '', gradeText: '' };
  }
  return { sourceComplete: null, score: '', gradeText: '' };
}

function parseGradescopePage(page, courseUrl) {
  if (!page || !page.hasTable && !page.noAssignments) throw new Error('Gradescope 课程页没有可识别的作业列表，原有数据已保留。');
  if (page.bodyRowCount > 0 && !page.rows?.length && !page.noAssignments) {
    throw new Error('Gradescope 作业行尚未识别，原有数据已保留。');
  }
  const base = new URL(courseUrl);
  const expectedPrefix = `${base.origin}${base.pathname.replace(/\/$/, '')}/assignments/`;
  const rows = [];
  for (const row of page.rows || []) {
    if (!row.name || !row.url) continue;
    let url;
    try { url = new URL(row.url, courseUrl); } catch { continue; }
    if (!url.href.startsWith(expectedPrefix) || url.username || url.password) continue;
    url.search = '';
    url.hash = '';
    const status = parseGradescopeStatus(row.status);
    rows.push({
      name: String(row.name).trim(), url: url.href, code: '', section: '',
      dueAt: parseGradescopeDate(row.due, page.timeZone, page.courseTitle),
      opensAt: parseGradescopeDate(row.released, page.timeZone, page.courseTitle),
      lateDueAt: parseGradescopeDate(row.lateDue, page.timeZone, page.courseTitle),
      sourceStatus: null,
      ...status,
    });
    if (String(row.due || '').trim() && !rows.at(-1).dueAt) {
      throw new Error('Gradescope 截止日期或时区无法识别，原有数据已保留。');
    }
  }
  if (page.rows?.length && !rows.length) throw new Error('Gradescope 作业链接未通过课程校验，原有数据已保留。');
  return { courseTitle: page.courseTitle || '', rows };
}

module.exports = { parseGradescopeDate, parseGradescopeStatus, parseGradescopePage };
