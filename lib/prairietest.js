const crypto = require('node:crypto');
const { parseGradescopeDate } = require('./gradescope');

const EXTRACT_PRAIRIETEST_PAGE = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,.card-header,.panel-heading')];
  const body = clean(document.body?.innerText).slice(0, 1200);
  const examHeadings = headings.filter(item => /^(?:exams? available for reservations?|(?:current and future )?exam reservations?|past reservations?)$/i.test(clean(item.innerText)));
  const hasExamSections = examHeadings.length > 0;
  let candidateCount = 0;
  let emptySections = 0;
  const rows = examHeadings.flatMap(heading => {
    const section = heading.closest('section,.card,.panel') || heading.parentElement;
    const links = [...(section?.querySelectorAll('a[href]') || [])].filter(link => {
      try {
        const url = new URL(link.href);
        return url.origin === location.origin && /\\/pt\\/[^?#]+/i.test(url.pathname) &&
          !/\\/pt\\/(?:docs|login|testing_centers?)(?:\\/|$)/i.test(url.pathname);
      }
      catch { return false; }
    });
    if (!links.length && /no (?:upcoming )?(?:exams|reservations)|you do(?:n't| not) currently have any exams available for reservations/i.test(clean(section?.innerText))) emptySections++;
    candidateCount += links.length;
    return links.map(link => {
      // PrairieTest can put the exam link and its scheduled time in sibling
      // columns without a .row or table element. Find the smallest ancestor
      // containing both, but never borrow a date from another exam in the card.
      let card = link.parentElement;
      for (let parent = card; parent && section.contains(parent); parent = parent.parentElement) {
        const text = clean(parent.innerText);
        const examLinks = links.filter(candidate => parent.contains(candidate));
        if (examLinks.length > 1) break;
        card = parent;
        if ((/\\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov)[a-z]*\\s+\\d{1,2}\\b/i.test(text) &&
             /\\b(?:PDT|PST|UTC|GMT)\\b/i.test(text)) || parent.querySelector('time[datetime]')) break;
        if (parent === section) break;
      }
      const timeElements = [...(card?.querySelectorAll('time[datetime]') || [])];
      return { name: clean(link.innerText), url: link.href,
        examId: link.closest('[data-exam-id]')?.getAttribute('data-exam-id') || section?.getAttribute('data-exam-id') || '',
        section: clean(heading.innerText).slice(0, 160), text: clean(card?.innerText).slice(0, 900),
        times: timeElements.map(item => ({ label: clean(item.parentElement?.innerText).slice(0, 160), datetime: item.dateTime })) };
    }).filter(item => item.name);
  });
  return { pageUrl: location.href, title: clean(document.title), body, hasExamSections,
    noExams: hasExamSections && candidateCount === 0 && emptySections === examHeadings.length,
    candidateCount, rows };
})()`;

function safePrairieTestUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('PrairieTest 页面链接无效。'); }
  if (url.protocol !== 'https:' || url.hostname !== 'us.prairietest.com' || url.username || url.password) throw new Error('PrairieTest 页面链接无效。');
  url.search = ''; url.hash = '';
  return url.href;
}
function sourceId(row) {
  if (/^[0-9a-f-]{1,80}$/i.test(row.examId || '')) return row.examId;
  const url = safePrairieTestUrl(row.examUrl || row.url);
  const exam = new URL(url).pathname.match(/\/exams?\/([0-9a-f-]{1,80})(?:\/|$)/i);
  if (exam) return exam[1];
  const reservation = new URL(url).pathname.match(/\/reservations?\/([0-9a-f-]{1,80})(?:\/|$)/i);
  if (reservation) return `reservation-${reservation[1]}`;
  const path = new URL(url).pathname;
  if (/^\/pt\/(?!docs(?:\/|$)|login(?:\/|$))[^?#]+/i.test(path)) {
    return `link-${crypto.createHash('sha256').update(path + '\n' + String(row.name || '')).digest('hex').slice(0, 24)}`;
  }
  throw new Error('PrairieTest 考试缺少稳定编号，原有数据已保留。');
}
function explicitDate(raw, zone, title) {
  if (!raw) return null;
  const iso = String(raw).match(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})/i);
  if (iso && Number.isFinite(Date.parse(iso[0]))) return new Date(iso[0]).toISOString();
  const normalized = String(raw).replace(/\b(\d{1,2})\s*(am|pm)\b/gi, '$1:00$2')
    .replace(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}),\s+(?=\d{1,2}:)/i, '$1 ');
  return parseGradescopeDate(normalized, zone, title);
}
function parsePrairieTestPage(page) {
  if (!page || !/^https:\/\/us\.prairietest\.com\/(?:pt(?:\/|$)|$)/i.test(page.pageUrl || '')) throw new Error('尚未登录 PrairieTest，或页面已跳转到登录站点。');
  if (/\/docs(?:\/|$)|\/login(?:\/|$)/i.test(new URL(page.pageUrl).pathname)) throw new Error('请先在专用窗口登录 PrairieTest，并打开 Home 页面。');
  if (!page.hasExamSections && !page.noExams) throw new Error('PrairieTest Home 页面未显示可识别的考试区域，原有数据已保留。');
  if (page.noExams && !page.rows?.length) return [];
  if (!page.rows?.length) throw new Error('PrairieTest 考试区域未显示可读取的考试，原有数据已保留。');
  const rows = [];
  const seen = new Set();
  for (const row of page.rows || []) {
    const section = String(row.section || '');
    const detail = String(row.text || '');
    const reservation = /current|future|upcoming|exam reservations?|my reservations?|已预约/i.test(section) ||
      /your reservation|you are reserved|scheduled for|reservation confirmed|已预约/i.test(detail);
    const available = /available|self.schedul|待预约|可预约/i.test(section) ||
      /reserve(?: now| this exam)?\b|make a reservation|待预约|可预约/i.test(detail);
    const ended = /past|completed|cancelled|canceled|已结束|已取消/i.test(section + ' ' + detail);
    if (!reservation && !available && !ended) continue;
    const id = sourceId(row);
    if (seen.has(id)) continue;
    seen.add(id);
    const status = ended ? /cancelled|canceled|已取消/i.test(detail) ? 'cancelled' : 'ended' : reservation ? 'reserved' : 'unreserved';
    const zone = /\bPDT\b/.test(detail) ? 'PDT' : /\bPST\b/.test(detail) ? 'PST' : /\b(?:UTC|GMT)\b/.test(detail) ? 'UTC' : null;
    const time = (row.times || []).find(item => /start|scheduled|exam|date|time|开始|考试/i.test(item.label || '')) || row.times?.[0];
    const startsAt = status === 'reserved' ? explicitDate(time?.datetime || detail, zone, row.name + ' ' + detail) : null;
    if (status === 'reserved' && !startsAt) throw new Error(`无法确认 ${row.name} 的预约时间及时区，原有数据已保留。`);
    const deadlineText = detail.match(/(?:reserv(?:ation|e)\s+(?:by|deadline)|book\s+by|预约截止)\s*[:：]?\s*([^.;]+)/i)?.[1] || '';
    const reservationDeadline = status === 'unreserved' ? explicitDate(deadlineText, zone, row.name + ' ' + detail) : null;
    const duration = detail.match(/(?:duration|时长)\s*[:：]?\s*(\d{1,3})\s*(?:minutes?|mins?|min|分钟)|(\d{1,3})\s*(?:minutes?|mins?|min)\b/i);
    const course = detail.match(/\b[A-Z]{2,5}[_\s]*(?:V[_\s]*)?\d{3}(?:[_\s]+\d{3})?\b/i);
    rows.push({ sourceId: id, title: String(row.name || '').trim(), courseName: course?.[0]?.replace(/[_\s]+/g, ' ') || '',
      status, startsAt, sourceTimeZone: zone ? zone === 'UTC' ? 'UTC' : 'America/Los_Angeles' : null,
      durationMinutes: duration ? Number(duration[1] || duration[2]) : null, reservationDeadline,
      location: detail.match(/\bORCA\s*:\s*.+?(?=\d{1,3}\s*min\b|,\s*(?:In-person|Online)|$)/i)?.[0]?.trim().slice(0, 300) || '',
      url: safePrairieTestUrl(row.examUrl || row.url), academicPeriod: null });
  }
  if ((page.candidateCount || (page.rows || []).length) && !rows.length) throw new Error('PrairieTest 考试行无法识别，原有数据已保留。');
  return rows;
}

module.exports = { EXTRACT_PRAIRIETEST_PAGE, safePrairieTestUrl, parsePrairieTestPage };
