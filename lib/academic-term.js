const PERIOD_PATTERN = /^(20\d{2})([WS])([12A])$/;

function normalizeAcademicPeriod(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return PERIOD_PATTERN.test(code) ? code : null;
}

function inferAcademicPeriod(...values) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const match = value.toUpperCase().match(/(?:^|[^A-Z0-9])(20\d{2}[WS](?:[12A])?)(?=$|[^A-Z0-9])/);
    if (!match) continue;
    return normalizeAcademicPeriod(match[1].length === 5 ? `${match[1]}A` : match[1]);
  }
  return null;
}

function normalizeCoursePeriod(course) {
  const hasPeriod = Object.hasOwn(course, 'academicPeriod');
  course.academicPeriodManual = course.academicPeriodManual === true;
  course.academicPeriod = hasPeriod && course.academicPeriodManual ? normalizeAcademicPeriod(course.academicPeriod)
    : normalizeAcademicPeriod(course.academicPeriod) || inferAcademicPeriod(course.name, course.url);
  course.archived = course.archived === true;
  return course;
}

function periodMatches(course, year, term) {
  const code = normalizeAcademicPeriod(course?.academicPeriod);
  if (year && (!code || String(Number(code.slice(0, 4)) - (code[4] === 'S' ? 1 : 0)) !== year)) return false;
  if (term === 'unknown') return code === null && !year;
  if (term && code?.slice(4) !== term && !(['W1', 'W2', 'S1', 'S2'].includes(term) && code?.slice(4) === `${term[0]}A`)) return false;
  return true;
}

module.exports = { normalizeAcademicPeriod, inferAcademicPeriod, normalizeCoursePeriod, periodMatches };
