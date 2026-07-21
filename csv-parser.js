/**
 * Robust CSV/Spreadsheet Parser for User Import
 * Handles messy data, fuzzy column matching, multiple formats
 */

/**
 * Detect the delimiter used in the content
 */
function detectDelimiter(firstLines) {
  const candidates = [
    { char: ',', name: 'comma' },
    { char: '\t', name: 'tab' },
    { char: ';', name: 'semicolon' },
    { char: '|', name: 'pipe' },
  ];

  const sample = firstLines.join('\n');
  let best = candidates[0];
  let bestScore = 0;

  for (const c of candidates) {
    const count = (sample.match(new RegExp(c.char === '|' ? '\\|' : c.char === '\t' ? '\t' : c.char, 'g')) || []).length;
    if (count > bestScore) {
      bestScore = count;
      best = c;
    }
  }

  return best.char;
}

/**
 * Parse CSV lines into rows using a delimiter, handling quoted fields
 */
function parseCSVLine(line, delimiter) {
  const rows = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      rows.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  rows.push(current.trim());
  return rows;
}

/**
 * Known column name mappings - fuzzy match headers to our fields
 */
const COLUMN_PATTERNS = {
  name: [
    /^name$/i, /^full.?name$/i, /^participant.?name$/i, /^user.?name$/i,
    /^member.?name$/i, /^person.?name$/i, /^attendee$/i, /^first.?name$/i,
    /^nombres?$/i, /^prenom$/i, /^nom$/i, /^participant$/i, /^attendee.?name$/i,
    /^member$/i, /^person$/i,
  ],
  registrationNumber: [
    /^id$/i, /^reg(istration)?.?num(ber)?$/i, /^student.?id$/i, /^member.?id$/i,
    /^participant.?id$/i, /^user.?id$/i, /^badge.?id$/i, /^ref(erence)?$/i,
    /^no\.?$/i, /^number$/i, /^code$/i, /^matric(ule)?$/i, /^id.?number$/i,
    /^id.?no\.?$/i, /^reg.?no\.?$/i, /^registration$/i,
  ],
  pin: [
    /^pin$/i, /^password$/i, /^pass$/i, /^secret$/i,
    /^pin.?code$/i, /^access.?code$/i, /^secret.?code$/i, /^passcode$/i,
  ],
  email: [
    /^e?-?mail$/i, /^email.?address$/i, /^contact.?email$/i,
  ],
  phone: [
    /^phone$/i, /^tel(e phone)?$/i, /^mobile$/i, /^cell$/i, /^contact$/i,
  ],
  department: [
    /^dept$/i, /^department$/i, /^division$/i, /^unit$/i, /^section$/i,
  ],
  role: [
    /^role$/i, /^position$/i, /^title$/i, /^job.?title$/i, /^designation$/i,
  ],
};

/**
 * Match a header string to a known field using fuzzy matching
 */
function matchHeader(header) {
  const clean = header.trim().toLowerCase().replace(/[\s\-_\.]+/g, '');

  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(header.trim())) return field;
    }
    // Fuzzy: check if the cleaned header contains the field name
    if (clean.includes(field.toLowerCase())) return field;
  }
  return null;
}

/**
 * Detect if a row matches the pipe-delimited format: Name: X | ID: Y | PIN: Z
 */
function parsePipeFormat(line) {
  const nameMatch = line.match(/Name:\s*(.+?)\s*\|/i);
  const idMatch = line.match(/ID:\s*(.+?)(?:\s*\||\s*$)/i);
  const pinMatch = line.match(/PIN:\s*(\d+)/i);

  if (nameMatch || idMatch || pinMatch) {
    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      registrationNumber: idMatch ? idMatch[1].trim() : '',
      pin: pinMatch ? pinMatch[1].trim() : '',
    };
  }
  return null;
}

/**
 * Generate a default PIN if missing
 */
function generatePIN() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Clean and normalize a user record
 */
function normalizeUser(record) {
  const name = (record.name || '').trim().replace(/\s+/g, ' ');
  let regNum = (record.registrationNumber || '').trim().toUpperCase().replace(/\s+/g, '');
  let pin = (record.pin || '').trim();

  // Validate: name must have at least 2 chars
  if (name.length < 2) return null;

  // If no registration number, try to generate from name
  if (!regNum) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) {
      regNum = parts[0].charAt(0).toUpperCase() + parts[1].charAt(0).toUpperCase() +
               String(Math.floor(1000 + Math.random() * 9000));
    } else {
      regNum = 'USER' + String(Math.floor(10000 + Math.random() * 90000));
    }
  }

  // Ensure PIN is 4-6 digits
  if (!pin || !/^\d{4,6}$/.test(pin)) {
    pin = generatePIN();
  }

  return { name, registrationNumber: regNum, pin };
}

/**
 * Main parser: accepts raw file content and returns normalized user records
 * Handles: CSV, TSV, pipe-delimited, semicolon, Excel exports, and the
 * existing "Name: X | ID: Y | PIN: Z" format
 *
 * Returns: { users: [], errors: [], stats: {} }
 */
function parseUserFile(content) {
  const users = [];
  const errors = [];
  const seen = new Set();
  let skippedDuplicate = 0;
  let skippedInvalid = 0;

  if (!content || !content.trim()) {
    return { users, errors: [{ row: 0, error: 'Empty file' }], stats: { total: 0, imported: 0, duplicates: 0, invalid: 0 } };
  }

  const lines = content.split(/\r?\n/).filter(l => l.trim());

  if (lines.length === 0) {
    return { users, errors: [{ row: 0, error: 'No data rows found' }], stats: { total: 0, imported: 0, duplicates: 0, invalid: 0 } };
  }

  // First, check if the entire file uses the pipe format: Name: X | ID: Y | PIN: Z
  const pipeFormatCount = lines.filter(l => /Name:\s*.+\|/.test(l)).length;
  if (pipeFormatCount > lines.length * 0.5) {
    // Pipe format
    lines.forEach((line, idx) => {
      const record = parsePipeFormat(line);
      if (record) {
        const normalized = normalizeUser(record);
        if (!normalized) { skippedInvalid++; errors.push({ row: idx + 1, error: 'Invalid record', data: line.slice(0, 80) }); return; }
        const key = normalized.registrationNumber;
        if (seen.has(key)) { skippedDuplicate++; return; }
        seen.add(key);
        users.push(normalized);
      } else {
        skippedInvalid++;
        errors.push({ row: idx + 1, error: 'Could not parse line', data: line.slice(0, 80) });
      }
    });

    return {
      users,
      errors,
      stats: { total: lines.length, imported: users.length, duplicates: skippedDuplicate, invalid: skippedInvalid },
    };
  }

  // First pass: try to find a header row
  const dataLines = [];
  let headerLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Try to detect if this is a header row by checking column names
    if (headerLine === -1) {
      const testCols = parseCSVLine(line, detectDelimiter(lines.slice(i, i + 2)));
      const matches = testCols.filter(c => matchHeader(c));
      if (matches.length >= 1) {
        headerLine = i;
        continue;
      }
    }

    dataLines.push({ index: i, line });
  }

  // Detect delimiter early
  const delimiter = detectDelimiter(lines);

  // If no header found, check if first row looks like data
  if (headerLine === -1) {
    const firstCols = parseCSVLine(lines[0], delimiter);
    const firstHasKnownHeader = firstCols.some(c => matchHeader(c));
    if (!firstHasKnownHeader && dataLines.length > 0) {
      // No header - treat ALL lines as data rows
      headerLine = -1;
    } else {
      headerLine = 0;
      dataLines.shift();
    }
  }

  // Parse header
  let headers = [];
  const fieldMap = {};

  if (headerLine >= 0) {
    headers = parseCSVLine(lines[headerLine], delimiter);
    headers.forEach((h, idx) => {
      const field = matchHeader(h);
      if (field) fieldMap[field] = idx;
    });
  }

  // If we couldn't match any headers, try positional mapping
  if (Object.keys(fieldMap).length === 0 && dataLines.length > 0) {
    // Use first data row to determine column count
    const sampleCols = parseCSVLine(dataLines[0].line, delimiter);
    const colCount = sampleCols.length;
    if (colCount >= 3) {
      fieldMap.name = 0;
      fieldMap.registrationNumber = 1;
      fieldMap.pin = 2;
    } else if (colCount === 2) {
      fieldMap.name = 0;
      fieldMap.registrationNumber = 1;
    }
  }

  // Parse data rows
  for (const { index: rowIdx, line } of dataLines) {
    const cols = parseCSVLine(line, delimiter);

    // Skip rows that are too short
    if (cols.length < 2) { skippedInvalid++; continue; }

    // Skip rows that look like headers (all text, no numbers, short)
    const firstCol = (cols[0] || '').toLowerCase();
    if (['name', 'full name', 'participant', 'id', '#'].includes(firstCol)) {
      continue;
    }

    const record = {};
    if (fieldMap.name !== undefined) record.name = cols[fieldMap.name] || '';
    if (fieldMap.registrationNumber !== undefined) record.registrationNumber = cols[fieldMap.registrationNumber] || '';
    if (fieldMap.pin !== undefined) record.pin = cols[fieldMap.pin] || '';
    if (fieldMap.email !== undefined) record.email = cols[fieldMap.email] || '';
    if (fieldMap.phone !== undefined) record.phone = cols[fieldMap.phone] || '';
    if (fieldMap.department !== undefined) record.department = cols[fieldMap.department] || '';
    if (fieldMap.role !== undefined) record.role = cols[fieldMap.role] || '';

    // Also try: if name is empty, check if any column looks like a full name
    if (!record.name) {
      for (let i = 0; i < cols.length; i++) {
        const val = (cols[i] || '').trim();
        if (val.length >= 3 && /^[a-zA-Z\s'\-\.]+$/.test(val) && !record.name) {
          record.name = val;
          break;
        }
      }
    }

    // If no reg number found, check for any alphanumeric ID-like column
    if (!record.registrationNumber) {
      for (let i = 0; i < cols.length; i++) {
        const val = (cols[i] || '').trim();
        if (/^[A-Z]{2,}\d{2,}$/i.test(val) || /^\d{4,}$/.test(val)) {
          record.registrationNumber = val;
          break;
        }
      }
    }

    const normalized = normalizeUser(record);
    if (!normalized) {
      skippedInvalid++;
      errors.push({ row: rowIdx + 1, error: 'Invalid or incomplete record', data: line.slice(0, 80) });
      continue;
    }

    const key = normalized.registrationNumber;
    if (seen.has(key)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(key);
    users.push(normalized);
  }

  return {
    users,
    errors,
    stats: {
      total: lines.length,
      imported: users.length,
      duplicates: skippedDuplicate,
      invalid: skippedInvalid,
      headersFound: headers,
      columnMapping: fieldMap,
    },
  };
}

module.exports = { parseUserFile, normalizeUser, matchHeader, detectDelimiter };
