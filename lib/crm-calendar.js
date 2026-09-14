const crypto = require("crypto");

const DEFAULT_TIME_ZONE = "Europe/Oslo";
const MAX_ICS_BYTES = 2 * 1024 * 1024;
const MAX_EVENTS = 750;
const CACHE_MS = 2 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

let memoryCache = { key: "", expiresAt: 0, value: null };

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanLongText(value, max = 4000) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, max);
}

function unescapeIcs(value) {
  return String(value || "")
    .replace(/\\[nN]/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function unfoldIcs(value) {
  return String(value || "").replace(/\r?\n[ \t]/g, "");
}

function parseProperty(line) {
  const separator = String(line || "").indexOf(":");
  if (separator < 1) return null;
  const left = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [rawName, ...rawParams] = left.split(";");
  const params = {};
  rawParams.forEach((item) => {
    const equals = item.indexOf("=");
    if (equals > 0) params[item.slice(0, equals).toUpperCase()] = item.slice(equals + 1).replace(/^"|"$/g, "");
  });
  return { name: rawName.toUpperCase(), params, value };
}

function parseEventComponents(source) {
  const lines = unfoldIcs(source).split(/\r?\n/);
  const events = [];
  let current = null;
  lines.forEach((line) => {
    if (line === "BEGIN:VEVENT") {
      current = {};
      return;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      return;
    }
    if (!current) return;
    const property = parseProperty(line);
    if (!property) return;
    if (!current[property.name]) current[property.name] = [];
    current[property.name].push(property);
  });
  return events;
}

function validTimeZone(value) {
  const zone = cleanText(value, 80) || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function datePartsInZone(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, item) => {
    if (item.type !== "literal") result[item.type] = item.value;
    return result;
  }, {});
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

function zonedDate(parts, timeZone = DEFAULT_TIME_ZONE) {
  const zone = validTimeZone(timeZone);
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observed = datePartsInZone(new Date(timestamp), zone);
    const observedTimestamp = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    timestamp += target - observedTimestamp;
  }
  return new Date(timestamp);
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function timeKey(parts) {
  return `${String(parts.hour || 0).padStart(2, "0")}:${String(parts.minute || 0).padStart(2, "0")}`;
}

function parseIcsDate(property, fallbackTimeZone = DEFAULT_TIME_ZONE) {
  if (!property?.value) return null;
  const raw = property.value.trim();
  const allDay = property.params?.VALUE === "DATE" || /^\d{8}$/.test(raw);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;
  const rawParts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4] || 0), minute: Number(match[5] || 0), second: Number(match[6] || 0),
  };
  const timeZone = match[7] ? "UTC" : validTimeZone(property.params?.TZID || fallbackTimeZone);
  const date = allDay
    ? new Date(Date.UTC(rawParts.year, rawParts.month - 1, rawParts.day))
    : match[7]
      ? new Date(Date.UTC(rawParts.year, rawParts.month - 1, rawParts.day, rawParts.hour, rawParts.minute, rawParts.second))
      : zonedDate(rawParts, timeZone);
  if (Number.isNaN(date.getTime())) return null;
  return {
    allDay,
    date,
    localDate: dateKey(rawParts),
    localTime: timeKey(rawParts),
    rawParts,
    timeZone,
    occurrenceKey: allDay ? dateKey(rawParts) : date.toISOString(),
  };
}

function propertyValue(component, name) {
  return component?.[name]?.[0]?.value || "";
}

function parseRule(value) {
  return Object.fromEntries(String(value || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [part.slice(0, separator).toUpperCase(), part.slice(separator + 1)] : [part.toUpperCase(), ""];
  }));
}

function normalizedEvent(component) {
  const start = parseIcsDate(component.DTSTART?.[0]);
  if (!start) return null;
  let end = parseIcsDate(component.DTEND?.[0], start.timeZone);
  if (!end) {
    const duration = start.allDay ? DAY_MS : 60 * 60 * 1000;
    end = { ...start, date: new Date(start.date.getTime() + duration) };
  }
  if (end.date <= start.date) end = { ...end, date: new Date(start.date.getTime() + (start.allDay ? DAY_MS : 60 * 60 * 1000)) };
  const recurrenceId = parseIcsDate(component["RECURRENCE-ID"]?.[0], start.timeZone);
  return {
    uid: cleanText(propertyValue(component, "UID"), 500) || crypto.randomUUID(),
    title: cleanText(unescapeIcs(propertyValue(component, "SUMMARY")), 240) || "Opptatt",
    description: cleanLongText(unescapeIcs(propertyValue(component, "DESCRIPTION")), 4000),
    location: cleanText(unescapeIcs(propertyValue(component, "LOCATION")), 500),
    status: cleanText(propertyValue(component, "STATUS"), 30).toUpperCase(),
    start,
    end,
    durationMs: Math.max(1, end.date.getTime() - start.date.getTime()),
    rule: parseRule(propertyValue(component, "RRULE")),
    hasRule: Boolean(propertyValue(component, "RRULE")),
    recurrenceId,
    exdates: (component.EXDATE || []).flatMap((property) => property.value.split(",").map((value) => parseIcsDate({ ...property, value }, start.timeZone)).filter(Boolean)),
  };
}

function serialDate(value) {
  const parts = typeof value === "string"
    ? value.split("-").map(Number)
    : [value.year, value.month, value.day];
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function utcDateParts(timestamp) {
  const date = new Date(timestamp);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function startOfWeek(timestamp, weekStart = "MO") {
  const weekday = new Date(timestamp).getUTCDay();
  const requested = WEEKDAYS.indexOf(weekStart);
  const delta = (weekday - (requested < 0 ? 1 : requested) + 7) % 7;
  return timestamp - delta * DAY_MS;
}

function matchesRecurrence(candidateTimestamp, event, rule) {
  const baseTimestamp = serialDate(event.start.rawParts);
  if (candidateTimestamp < baseTimestamp) return false;
  const interval = Math.max(1, Math.min(Number(rule.INTERVAL) || 1, 100));
  const frequency = rule.FREQ;
  const parts = utcDateParts(candidateTimestamp);
  const base = event.start.rawParts;
  const daysDifference = Math.round((candidateTimestamp - baseTimestamp) / DAY_MS);
  if (frequency === "DAILY") return daysDifference % interval === 0;
  if (frequency === "WEEKLY") {
    const allowedDays = (rule.BYDAY || WEEKDAYS[new Date(baseTimestamp).getUTCDay()]).split(",").map((item) => item.replace(/^[+-]?\d+/, ""));
    const weekDifference = Math.round((startOfWeek(candidateTimestamp, rule.WKST) - startOfWeek(baseTimestamp, rule.WKST)) / (7 * DAY_MS));
    return weekDifference % interval === 0 && allowedDays.includes(WEEKDAYS[new Date(candidateTimestamp).getUTCDay()]);
  }
  if (frequency === "MONTHLY") {
    const monthDifference = (parts.year - base.year) * 12 + parts.month - base.month;
    const allowedMonthDays = (rule.BYMONTHDAY || String(base.day)).split(",").map(Number);
    return monthDifference >= 0 && monthDifference % interval === 0 && allowedMonthDays.includes(parts.day);
  }
  if (frequency === "YEARLY") {
    const allowedMonths = (rule.BYMONTH || String(base.month)).split(",").map(Number);
    return (parts.year - base.year) % interval === 0 && allowedMonths.includes(parts.month) && parts.day === base.day;
  }
  return candidateTimestamp === baseTimestamp;
}

function occurrenceStart(event, calendarDateParts) {
  if (event.start.allDay) return new Date(Date.UTC(calendarDateParts.year, calendarDateParts.month - 1, calendarDateParts.day));
  return zonedDate({ ...calendarDateParts, hour: event.start.rawParts.hour, minute: event.start.rawParts.minute, second: event.start.rawParts.second }, event.start.timeZone);
}

function publicEvent(event, startDate, endDate, occurrenceKey, recurring = false) {
  const displayStart = event.start.allDay ? utcDateParts(startDate.getTime()) : datePartsInZone(startDate, DEFAULT_TIME_ZONE);
  const displayEnd = event.start.allDay ? utcDateParts(endDate.getTime()) : datePartsInZone(endDate, DEFAULT_TIME_ZONE);
  return {
    id: `gcal-${crypto.createHash("sha256").update(`${event.uid}|${occurrenceKey}`).digest("hex").slice(0, 24)}`,
    title: event.title,
    description: event.description,
    location: event.location,
    date: dateKey(displayStart),
    endDateExclusive: dateKey(displayEnd),
    startTime: event.start.allDay ? "" : timeKey(displayStart),
    endTime: event.start.allDay ? "" : timeKey(displayEnd),
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    allDay: event.start.allDay,
    recurring,
    source: "Google Calendar",
  };
}

function inRange(start, end, rangeStart, rangeEnd) {
  return end > rangeStart && start < rangeEnd;
}

function expandRecurringEvent(event, exceptions, rangeStart, rangeEnd) {
  const output = [];
  const consumedExceptions = new Set();
  const exdates = new Set(event.exdates.map((item) => item.occurrenceKey));
  const rule = event.rule;
  const until = rule.UNTIL ? parseIcsDate({ params: {}, value: rule.UNTIL }, event.start.timeZone)?.date : null;
  const countLimit = Math.max(0, Math.min(Number(rule.COUNT) || 0, MAX_EVENTS));
  const baseSerial = serialDate(event.start.rawParts);
  const rangeStartParts = datePartsInZone(rangeStart, event.start.timeZone);
  const rangeEndParts = datePartsInZone(rangeEnd, event.start.timeZone);
  const firstSerial = Math.max(baseSerial, serialDate(rangeStartParts) - 8 * DAY_MS);
  const lastSerial = serialDate(rangeEndParts) + 8 * DAY_MS;
  let occurrenceNumber = 0;
  let inspected = 0;

  for (let cursor = baseSerial; cursor <= lastSerial && inspected < 5000 && output.length < MAX_EVENTS; cursor += DAY_MS) {
    inspected += 1;
    if (!matchesRecurrence(cursor, event, rule)) continue;
    occurrenceNumber += 1;
    if (countLimit && occurrenceNumber > countLimit) break;
    if (cursor < firstSerial) continue;
    const calendarParts = utcDateParts(cursor);
    const start = occurrenceStart(event, calendarParts);
    if (until && start > until) break;
    const key = event.start.allDay ? dateKey(calendarParts) : start.toISOString();
    if (exdates.has(key)) continue;
    const exception = exceptions.get(`${event.uid}|${key}`);
    if (exception) {
      consumedExceptions.add(`${event.uid}|${key}`);
      if (exception.status !== "CANCELLED" && inRange(exception.start.date, exception.end.date, rangeStart, rangeEnd)) {
        output.push(publicEvent(exception, exception.start.date, exception.end.date, key, true));
      }
      continue;
    }
    const end = new Date(start.getTime() + event.durationMs);
    if (inRange(start, end, rangeStart, rangeEnd)) output.push(publicEvent(event, start, end, key, true));
  }
  return { output, consumedExceptions };
}

function parseIcsCalendar(source, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const defaultFrom = new Date(now.getTime() - 62 * DAY_MS);
  const defaultTo = new Date(now.getTime() + 400 * DAY_MS);
  const rangeStart = options.from ? new Date(options.from) : defaultFrom;
  const rangeEnd = options.to ? new Date(options.to) : defaultTo;
  const components = parseEventComponents(source).map(normalizedEvent).filter(Boolean);
  const exceptions = new Map();
  components.filter((event) => event.recurrenceId).forEach((event) => {
    exceptions.set(`${event.uid}|${event.recurrenceId.occurrenceKey}`, event);
  });
  const consumedExceptions = new Set();
  const events = [];

  components.forEach((event) => {
    if (event.recurrenceId || event.status === "CANCELLED") return;
    if (event.hasRule) {
      const expanded = expandRecurringEvent(event, exceptions, rangeStart, rangeEnd);
      events.push(...expanded.output);
      expanded.consumedExceptions.forEach((key) => consumedExceptions.add(key));
      return;
    }
    if (inRange(event.start.date, event.end.date, rangeStart, rangeEnd)) {
      events.push(publicEvent(event, event.start.date, event.end.date, event.start.occurrenceKey));
    }
  });

  exceptions.forEach((event, key) => {
    if (!consumedExceptions.has(key) && event.status !== "CANCELLED" && inRange(event.start.date, event.end.date, rangeStart, rangeEnd)) {
      events.push(publicEvent(event, event.start.date, event.end.date, event.recurrenceId.occurrenceKey, true));
    }
  });

  const unique = [...new Map(events.map((event) => [event.id, event])).values()]
    .sort((left, right) => left.startAt.localeCompare(right.startAt))
    .slice(0, MAX_EVENTS);
  const nameMatch = unfoldIcs(source).match(/^X-WR-CALNAME:(.*)$/m);
  return {
    calendarName: cleanText(unescapeIcs(nameMatch?.[1]), 160) || "Loki Lydstudio",
    timeZone: DEFAULT_TIME_ZONE,
    events: unique,
  };
}

function calendarFeedUrl(value = process.env.GOOGLE_CALENDAR_ICS_URL) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.hostname !== "calendar.google.com") return null;
    if (!/^\/calendar\/ical\/[^/]+\/private-[^/]+\/basic\.ics$/.test(url.pathname)) return null;
    return url;
  } catch {
    return null;
  }
}

async function loadGoogleCalendar(options = {}) {
  const url = calendarFeedUrl();
  if (!url) return { configured: false, readOnly: true, calendarName: "Google Calendar", timeZone: DEFAULT_TIME_ZONE, events: [] };
  const now = options.now instanceof Date ? options.now : new Date();
  const from = options.from || new Date(now.getTime() - 62 * DAY_MS).toISOString();
  const to = options.to || new Date(now.getTime() + 400 * DAY_MS).toISOString();
  const cacheKey = `${from}|${to}`;
  if (!options.refresh && memoryCache.key === cacheKey && memoryCache.expiresAt > Date.now() && memoryCache.value) return memoryCache.value;

  const response = await (options.fetchImpl || fetch)(url, {
    redirect: "follow",
    headers: { accept: "text/calendar,text/plain;q=0.9" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Google Calendar svarte med status ${response.status}.`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_ICS_BYTES) throw new Error("Google-kalenderen er for stor til å behandles sikkert.");
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > MAX_ICS_BYTES || !source.includes("BEGIN:VCALENDAR")) throw new Error("Google Calendar returnerte en ugyldig ICS-feed.");
  const parsed = parseIcsCalendar(source, { from, to, now });
  const value = { configured: true, readOnly: true, refreshedAt: new Date().toISOString(), ...parsed };
  memoryCache = { key: cacheKey, expiresAt: Date.now() + CACHE_MS, value };
  return value;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  calendarFeedUrl,
  loadGoogleCalendar,
  parseIcsCalendar,
  parseIcsDate,
};
