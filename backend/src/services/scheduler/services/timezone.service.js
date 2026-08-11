export const DEFAULT_TENANT_TIMEZONE = process.env.TIMEZONE || '-03:00';

export const parseOffsetTimezone = (timezone) => {
    if (!timezone || typeof timezone !== 'string') return null;
    const match = timezone.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!match) return null;
    const [, sign, hours, minutes] = match;
    const total = (parseInt(hours, 10) * 60) + parseInt(minutes, 10);
    return sign === '-' ? -total : total;
};

const getTimezoneParts = (date, timezone) => {
    const offsetMinutes = parseOffsetTimezone(timezone);
    if (offsetMinutes !== null) {
        const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
        return {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: shifted.getUTCHours(),
            minute: shifted.getUTCMinutes(),
            second: shifted.getUTCSeconds(),
        };
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type) => Number(parts.find(p => p.type === type)?.value || 0);
    return {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        hour: get('hour'),
        minute: get('minute'),
        second: get('second'),
    };
};

const getIanaTimezoneOffsetMinutes = (timezone, date) => {
    const parts = getTimezoneParts(date, timezone);
    const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((localAsUtc - date.getTime()) / (60 * 1000));
};

const buildStartOfLocalDay = (parts, timezone) => {
    const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0);
    const offsetMinutes = parseOffsetTimezone(timezone);
    if (offsetMinutes !== null) {
        return new Date(utcMidnight - offsetMinutes * 60 * 1000);
    }

    let start = new Date(utcMidnight);
    let ianaOffset = getIanaTimezoneOffsetMinutes(timezone, start);
    start = new Date(utcMidnight - ianaOffset * 60 * 1000);
    ianaOffset = getIanaTimezoneOffsetMinutes(timezone, start);
    return new Date(utcMidnight - ianaOffset * 60 * 1000);
};

export const getTenantLocalDayWindow = (date = new Date(), timezone = DEFAULT_TENANT_TIMEZONE) => {
    try {
        const resolvedTimezone = timezone || DEFAULT_TENANT_TIMEZONE;
        const parts = getTimezoneParts(date, resolvedTimezone);
        return {
            timezone: resolvedTimezone,
            dayOfMonth: parts.day,
            monthOfYear: parts.month,
            startOfDay: buildStartOfLocalDay(parts, resolvedTimezone),
        };
    } catch (error) {
        const fallback = '-03:00';
        const parts = getTimezoneParts(date, fallback);
        return {
            timezone: fallback,
            dayOfMonth: parts.day,
            monthOfYear: parts.month,
            startOfDay: buildStartOfLocalDay(parts, fallback),
        };
    }
};