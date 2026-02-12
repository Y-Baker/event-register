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

function serializeAttendanceCsv(participants) {
  const rows = [ATTENDANCE_EXPORT_HEADERS.join(',')];

  for (const participant of participants || []) {
    const values = [
      participant.participantId,
      participant.name,
      participant.email,
      participant.scannedCount,
      participant.lastScannedAt || '',
      Array.isArray(participant.activityNames) ? participant.activityNames.join('; ') : '',
    ];

    rows.push(values.map(escapeCsvField).join(','));
  }

  return `${rows.join('\n')}\n`;
}

module.exports = {
  ATTENDANCE_EXPORT_HEADERS,
  serializeAttendanceCsv,
};
