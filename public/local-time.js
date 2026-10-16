const UBCClock = (() => {
  const BC_ZONE = 'America/Vancouver';
  const BC_FIXED_FROM = Date.parse('2026-03-08T10:00:00Z');
  let systemZone = null;

  function configure(zone) { systemZone = zone === BC_ZONE ? BC_ZONE : null; }
  function zoneFor(value) {
    if (!systemZone) return null;
    return new Date(value).getTime() >= BC_FIXED_FROM ? 'Etc/GMT+7' : BC_ZONE;
  }
  function format(locale, options, value, sourceZone = null) {
    const zone = sourceZone === BC_ZONE && new Date(value).getTime() >= BC_FIXED_FROM
      ? 'Etc/GMT+7' : sourceZone || zoneFor(value);
    return new Intl.DateTimeFormat(locale, zone ? { ...options, timeZone: zone } : options).format(new Date(value));
  }
  function parts(value) {
    const date = new Date(value);
    if (!systemZone) return {
      year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
      hour: date.getHours(), minute: date.getMinutes(),
    };
    const result = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: zoneFor(date), year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    return result;
  }
  const pad = value => String(value).padStart(2, '0');
  function dateKey(value) {
    const { year, month, day } = parts(value);
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  function inputValue(value) {
    const { year, month, day, hour, minute } = parts(value);
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
  }
  function offsetMinutes(value) {
    const date = new Date(value);
    if (!systemZone) return -date.getTimezoneOffset();
    const { year, month, day, hour, minute } = parts(date);
    return (Date.UTC(year, month - 1, day, hour, minute) - Math.floor(date.getTime() / 60000) * 60000) / 60000;
  }
  function parseInput(value) {
    if (!systemZone) return new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return new Date(NaN);
    const wallTime = Date.parse(`${value}Z`);
    let instant = wallTime;
    for (let index = 0; index < 3; index++) {
      const shown = parts(instant);
      const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
      const corrected = instant + wallTime - shownAsUtc;
      if (corrected === instant) break;
      instant = corrected;
    }
    return inputValue(instant) === value ? new Date(instant) : new Date(NaN);
  }
  function label() { return systemZone || Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
  return { configure, format, parts, dateKey, inputValue, offsetMinutes, parseInput, label };
})();

if (typeof module === 'object' && module.exports) module.exports = UBCClock;
