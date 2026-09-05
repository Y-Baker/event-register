const ATTENDANCE_EXPORT_HEADERS = [
  'participantId',
  'name',
  'email',
  'scannedCount',
  'lastScannedAt',
  'activityNames',
];

const FORMULA_PREFIXES = new Set(['=', '+', '-', '@']);

function sanitizeForFormulaInjection(value) {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trimStart();
  if (!trimmed) return raw;

  const firstChar = trimmed[0];
  if (FORMULA_PREFIXES.has(firstChar)) {
    return `'${raw}`;
  }

  return raw;
}

function escapeCsvField(value) {
  const sanitized = sanitizeForFormulaInjection(value);
  if (/["\n\r,]/.test(sanitized)) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

function serializeAttendanceCsv(participants, options = {}) {
  const customFields = options.customFields || [];
  const extraHeaders = customFields.map((f) => f.label || f.id);
  const headers = [...ATTENDANCE_EXPORT_HEADERS, ...extraHeaders];
  const rows = [headers.map(escapeCsvField).join(',')];

  const activityMap = new Map();
  if (Array.isArray(options.activities)) {
    for (const act of options.activities) {
      if (act && act._id) {
        activityMap.set(String(act._id), act.name || 'Activity');
      }
    }
  }

  for (const participant of participants || []) {
    const customResponses = participant.customResponses || {};
    const scans = participant.scannedActivities || [];
    let lastScannedAt = participant.lastScannedAt || '';
    const activityNames = new Set();

    if (Array.isArray(scans)) {
      for (const scan of scans) {
        if (!scan) continue;
        if (scan.scannedAt && !lastScannedAt) {
          lastScannedAt = new Date(scan.scannedAt).toISOString();
        }
        if (scan.activityId && activityMap.has(String(scan.activityId))) {
          activityNames.add(activityMap.get(String(scan.activityId)));
        }
      }
    }

    if (Array.isArray(participant.activityNames)) {
      participant.activityNames.forEach((n) => activityNames.add(n));
    }

    const values = [
      participant.participantId || participant._id,
      participant.name || '',
      participant.email || '',
      participant.scannedCount !== undefined ? participant.scannedCount : scans.length,
      lastScannedAt,
      Array.from(activityNames).join('; '),
      ...customFields.map((f) => {
        const val = customResponses[f.id];
        if (Array.isArray(val)) return val.join('; ');
        if (val === true) return 'Yes';
        if (val === false) return 'No';
        return val != null ? String(val) : '';
      }),
    ];

    rows.push(values.map(escapeCsvField).join(','));
  }

  return `${rows.join('\n')}\n`;
}

module.exports = {
  ATTENDANCE_EXPORT_HEADERS,
  serializeAttendanceCsv,
  escapeCsvField,
  sanitizeForFormulaInjection,
};
