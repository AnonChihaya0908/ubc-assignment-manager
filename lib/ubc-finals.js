const crypto = require('node:crypto');

const UBC_FINALS_URL = 'https://ubc.appiancloud.com/suite/sites/irps/group/student/page/final-exams';

// Reads the rendered grid only. Scrolling is handled by the browser reader;
// this expression never clicks a control or sends a request to Appian.
const EXTRACT_UBC_FINALS_PAGE = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const candidates = [...document.querySelectorAll('table,[role="grid"],[role="table"]')];
  const grid = candidates.find(element => {
    const headers = [...element.querySelectorAll('th,[role="columnheader"]')].map(item => clean(item.innerText).toLowerCase());
    return ['campus', 'academic period', 'section', 'exam date', 'exam start time'].every(name => headers.some(header => header.includes(name)));
  });
  const headers = grid ? [...grid.querySelectorAll('th,[role="columnheader"]')].map(item => clean(item.innerText)) : [];
  const rows = grid ? [...grid.querySelectorAll('tbody tr,[role="row"]')].map(row =>
    [...row.querySelectorAll('td,th[scope="row"],[role="gridcell"],[role="cell"],[role="rowheader"]')].map(cell => clean(cell.innerText))).filter(row => row.length >= 5) : [];
  const container = grid && [grid, ...(() => { const ancestors = []; for (let node = grid.parentElement; node; node = node.parentElement) ancestors.push(node); return ancestors; })()]
    .find(node => node.scrollHeight > node.clientHeight + 8 && node.clientHeight > 40);
  const footer = clean(grid?.parentElement?.parentElement?.innerText || '').match(/(\\d{1,4})\\s+items?\\b/i);
  return { pageUrl: location.href, title: clean(document.title), headers, rows,
    totalItems: footer ? Number(footer[1]) : null,
    scrollTop: container?.scrollTop || 0, scrollHeight: container?.scrollHeight || 0,
    clientHeight: container?.clientHeight || 0 };
})()`;

const SCROLL_UBC_FINALS_GRID = `(() => {
  const grid = [...document.querySelectorAll('table,[role="grid"],[role="table"]')].find(element =>
    /Exam Start Time/i.test(element.innerText || ''));
  for (let node = grid; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 8 && node.clientHeight > 40) {
      const before = node.scrollTop;
      node.scrollTop = Math.min(node.scrollHeight, before + Math.max(100, node.clientHeight * .8));
      return node.scrollTop > before;
    }
  }
  return false;
})()`;

function academicPeriod(raw) {
  const value = String(raw || '');
  const match = value.match(/(20\d{2})(?:\s*[-–]\s*\d{2,4})?\s*(Winter|Summer)\s*Term\s*([12])/i);
  return match ? `${match[1]}${match[2].toLowerCase() === 'winter' ? 'W' : 'S'}${match[3]}` : null;
}

function sectionCode(raw) {
  const match = String(raw || '').match(/\b([A-Z]{2,5})\s*(?:_\s*[VO])?\s*([1-9]\d{2})\s*[-–]\s*(\d{3})\b/i);
  return match ? { subject: match[1].toUpperCase(), number: match[2], section: match[3] } : null;
}

function vancouverInstant(date, time) {
  const d = String(date || '').match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  const t = String(time || '').match(/^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  if (!d || !t) throw new Error('UBC 考试日期或开始时间无效，原有数据已保留。');
  const [month, day, year] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const wall = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]), Number(t[3] || 0));
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day)
    throw new Error('UBC 考试日期无效，原有数据已保留。');
  // BC uses permanent UTC-7 from March 8, 2026. Earlier winter dates use UTC-8.
  const permanent = wall >= Date.UTC(2026, 2, 8, 3);
  const march = new Date(Date.UTC(year, 2, 1)).getUTCDay();
  const november = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const dstStart = Date.UTC(year, 2, 8 + (7 - march) % 7, 2);
  const dstEnd = Date.UTC(year, 10, 1 + (7 - november) % 7, 2);
  const offset = permanent || wall >= dstStart && wall < dstEnd ? 7 : 8;
  return new Date(wall + offset * 3600000).toISOString();
}

function matchingCourse(courses, code, period) {
  const candidates = (courses || []).filter(course => {
    if (course.archived || !course.accessConfirmedAt || course.academicPeriod !== period) return false;
    const name = String(course.name || '').toUpperCase().replace(/_/g, ' ');
    return new RegExp(`^${code.subject}(?:\\s+[VO])?\\s*${code.number}(?!\\d)`).test(name);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function parseUbcFinalsPage(page, courses = []) {
  if (!page || !page.pageUrl?.startsWith(UBC_FINALS_URL)) throw new Error('请先在专用窗口登录 UBC 考试日程页面。');
  const headers = (page.headers || []).map(value => String(value).toLowerCase());
  const column = name => headers.findIndex(value => value.includes(name));
  if (['campus', 'academic period', 'section', 'exam date', 'exam start time'].some(name => column(name) < 0))
    throw new Error('UBC 页面尚未显示可识别的考试表格，原有数据已保留。');
  if (!Array.isArray(page.rows) || !page.rows.length && page.totalItems !== 0)
    throw new Error('UBC 考试表格尚未显示考试行，原有数据已保留。');
  if (page.totalItems != null && page.rows.length < page.totalItems)
    throw new Error('UBC 考试列表尚未完整读取，原有数据已保留。');
  const exams = [];
  const seen = new Set();
  for (const cells of page.rows || []) {
    const cell = name => String(cells[column(name)] || '').trim();
    const code = sectionCode(cell('section'));
    const period = academicPeriod(cell('academic period'));
    if (!code || !period) throw new Error('UBC 考试行的课程或学期无法识别，原有数据已保留。');
    const campus = cell('campus');
    const split = column('alpha split') < 0 ? '' : cell('alpha split');
    const sourceId = crypto.createHash('sha256').update([campus, period, code.subject, code.number, code.section, split].join('|')).digest('hex').slice(0, 32);
    if (seen.has(sourceId)) throw new Error('UBC 考试表格有重复行，原有数据已保留。');
    seen.add(sourceId);
    const course = matchingCourse(courses, code, period);
    const location = column('location') < 0 ? '' : cell('location');
    const mode = column('delivery mode') < 0 ? '' : cell('delivery mode');
    const note = column('exam note') < 0 ? '' : cell('exam note');
    exams.push({ sourceId, title: `${code.subject} ${code.number} Final Exam${split && split !== '—' ? ` (${split})` : ''}`,
      courseName: `${code.subject} ${code.number}`, courseId: course?.id || null, academicPeriod: period,
      status: 'reserved', startsAt: vancouverInstant(cell('exam date'), cell('exam start time')),
      sourceTimeZone: 'America/Vancouver', durationMinutes: null,
      location: [location, mode, note].filter(value => value && value !== '—').join(' · ').slice(0, 300),
      url: UBC_FINALS_URL });
  }
  return exams;
}

module.exports = { UBC_FINALS_URL, EXTRACT_UBC_FINALS_PAGE, SCROLL_UBC_FINALS_GRID,
  academicPeriod, sectionCode, vancouverInstant, matchingCourse, parseUbcFinalsPage };
