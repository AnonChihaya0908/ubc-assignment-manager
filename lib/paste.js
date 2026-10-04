function parseCopiedTable(source, course) {
  const lines = String(source || '').split(/\r?\n/);
  const rows = [];
  let section = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = trimmed.split(/\t+/).map(cell => cell.trim()).filter(Boolean);
    const first = cells[0] || '';
    const match = first.match(/^([A-Z]{2,10}\d{1,4})\s*(.*)$/i);
    if (!match) {
      if (!/Assessments|Available credit|Score/i.test(trimmed) && cells.length === 1 && trimmed.length < 100) section = trimmed;
      continue;
    }
    const code = match[1].toUpperCase();
    const name = match[2] || cells[1] || '';
    if (!name) continue;
    const creditText = cells.find(cell => /\d+\s*%\s+until\b/i.test(cell)) || '';
    const score = cells.findLast(cell => /^(?:\d+(?:\.\d+)?%|Not started)$/i.test(cell)) || '';
    rows.push({ code, name, section, url: `${course.url}#${encodeURIComponent(code)}`, creditText, score });
  }
  return { courseTitle: course.name, rows };
}

module.exports = { parseCopiedTable };
