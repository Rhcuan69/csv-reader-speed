// csv-reader-speed: a faster drop-in for make.fun's csv-reader 1.0.0.
//
// Answers exactly what csv-reader 1.0.0 returns for every {text, header}:
// {columns, rows, errors}. Same broken-row policy, same error records, same
// order. Written from scratch as one left-to-right pass; where the reference
// builds every field a character at a time, this one finds each field's end
// with native scans (String#indexOf) and cuts the field out with one slice,
// so the common case (a short unquoted field, a quoted field with no doubled
// quotes and no line breaks inside) costs a couple of native scans and one
// substring instead of a rope of per-character appends.
//
// No dependencies, no imports. Pure: nothing kept from one call to the next.

const COMMA = 0; // field ended at a comma: the record goes on
const BREAK = 1; // field ended at a line break: the record ends
const END = 2; // field ended at the end of the text: the record ends

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1; // a U+FEFF at the very start is dropped

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters the
  // unquoted scan kept (the junk check needs that count, not the value's length).
  let fv = '';
  let fe = END;
  let fa = 0;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos, onto `first` ('' normally, '"' when
  // a quote that never closed is re-read as a literal). Sets fv/fe/fa.
  // A CR not followed by LF is dropped (stray_cr); a CRLF ends the field.
  function readUnquoted(first) {
    let p = pos;
    const iC = text.indexOf(',', p);
    const iN = text.indexOf('\n', p);
    let m; // index of the delimiter that ends the field, -1 when there is none
    let kind; // COMMA, BREAK, or END
    if (iC !== -1 && (iN === -1 || iC < iN)) { m = iC; kind = COMMA; }
    else if (iN !== -1) { m = iN; kind = BREAK; }
    else { m = -1; kind = END; }
    const seg = kind === END ? text.slice(p) : text.slice(p, m);
    const r = seg.indexOf('\r');
    if (r === -1) {
      // No CR in the field: one slice is the whole value.
      if (kind === COMMA) { pos = m + 1; }
      else if (kind === BREAK) { pos = m + 1; line += 1; }
      else { pos = n; }
      fv = first ? first + seg : seg;
      fe = kind;
      fa = seg.length;
      return;
    }
    if (kind === BREAK && r === seg.length - 1) {
      // The only CR is the one of the CRLF that ends the field: the LF is at
      // m, so the next field starts at m + 1.
      const v = seg.slice(0, -1);
      pos = m + 1;
      line += 1;
      fv = first ? first + v : v;
      fe = BREAK;
      fa = v.length;
      return;
    }
    // The field holds a stray CR (or several): walk the CRs, dropping the stray
    // ones and stopping at a CRLF, which ends the field. Rare: stray CRs hit
    // about 4 records in 1000, so this path may take its time.
    const parts = [];
    if (first) parts.push(first);
    let start = 0;
    let j = r;
    let ended = -1; // BREAK once a CRLF inside the field ends it, else unset
    for (;;) {
      // The character after this CR: inside the slice, the delimiter at m, or nothing.
      const after = j + 1 < seg.length ? seg.charCodeAt(j + 1)
        : kind === BREAK ? 10 : kind === COMMA ? 44 : -1;
      if (after === 10) {
        // CRLF: the field ends here.
        parts.push(seg.slice(start, j));
        pos = p + j + 2;
        line += 1;
        ended = BREAK;
        break;
      }
      pushError('stray_cr');
      parts.push(seg.slice(start, j));
      start = j + 1;
      const nj = seg.indexOf('\r', start);
      if (nj === -1) break;
      j = nj;
    }
    if (ended !== BREAK) {
      // No CRLF inside the field: the rest of the slice belongs to it, and it
      // ends at the delimiter that was found (or the end of the text).
      parts.push(seg.slice(start));
      if (kind === COMMA) pos = m + 1;
      else if (kind === BREAK) { pos = m + 1; line += 1; }
      else pos = n;
      ended = kind;
    }
    fv = parts.join('');
    fe = ended;
    fa = fv.length - first.length;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv/fe/fa.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    let acc = null; // pieces when the field spans doubled quotes
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as an unquoted field.
        pos = open + 1;
        line = openLine;
        pushError('unterminated_quote');
        readUnquoted('"');
        return;
      }
      let seg = text.slice(p, q);
      if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
        // CRLF and a lone CR inside quotes are each one LF, and each counts a line.
        let breaks = 0;
        seg = seg.replace(/\r\n|\r|\n/g, () => { breaks += 1; return '\n'; });
        line += breaks;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        if (acc) acc.push(seg, '"');
        else acc = [seg, '"'];
        p = q + 2;
        continue;
      }
      // The closing quote. What follows decides how the field ends.
      fv = acc ? (acc.push(seg), acc.join('')) : seg;
      const after = q + 1;
      if (after >= n) { pos = n; fe = END; fa = 0; return; }
      const c = text.charCodeAt(after);
      if (c === 44) { pos = after + 1; fe = COMMA; fa = 0; return; }
      if (c === 10) { pos = after + 1; line += 1; fe = BREAK; fa = 0; return; }
      if (c === 13 && text.charCodeAt(after + 1) === 10) {
        pos = after + 2;
        line += 1;
        fe = BREAK;
        fa = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break.
      pos = after;
      readUnquoted(fv);
      if (fa > 0) pushError('quote_junk');
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted();
      } else {
        quoted = false;
        readUnquoted('');
      }
      fields.push(fv);
    } while (fe === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
