const path = require("path");
const zlib = require("zlib");

const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_CONTACTS = 1000;

function xmlText(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const number = entity[1].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : "";
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()] || match;
  });
}

function xmlAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes[match[1]] = xmlText(match[3]);
  }
  return attributes;
}

function unzipXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_XLSX_BYTES) throw new Error("Filen er for stor eller ugyldig.");
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Filen er ikke en gyldig XLSX-fil.");

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("XLSX-arkivet er skadet.");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const filenameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + filenameLength).toString("utf8");
    cursor += 46 + filenameLength + extraLength + commentLength;
    if (uncompressedSize > MAX_ENTRY_BYTES || !/^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name)) continue;
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("XLSX-arkivet inneholder en ugyldig filoppføring.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(start, start + compressedSize);
    const contents = method === 0 ? Buffer.from(compressed) : method === 8 ? zlib.inflateRawSync(compressed) : null;
    if (!contents || contents.length > MAX_ENTRY_BYTES) throw new Error("XLSX-filen bruker et format som ikke støttes.");
    entries.set(name, contents.toString("utf8"));
  }
  return entries;
}

function workbookSheetPath(entries) {
  const workbook = entries.get("xl/workbook.xml") || "";
  const relationships = entries.get("xl/_rels/workbook.xml.rels") || "";
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)].map((match) => xmlAttributes(match[1]));
  const selected = sheets.find((sheet) => String(sheet.name || "").trim().toLowerCase() === "kontakter") || sheets[0];
  if (!selected) throw new Error("Fant ingen ark i Fiken-filen.");
  const relationshipId = selected["r:id"];
  const relationship = [...relationships.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)]
    .map((match) => xmlAttributes(match[1]))
    .find((item) => item.Id === relationshipId);
  if (!relationship?.Target) throw new Error("Fant ikke kontaktarket i Fiken-filen.");
  const target = relationship.Target.replace(/^\//, "");
  return target.startsWith("xl/") ? target : path.posix.normalize(`xl/${target}`);
}

function sharedStrings(entries) {
  const xml = entries.get("xl/sharedStrings.xml") || "";
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((item) => {
    const texts = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => xmlText(match[1]));
    return texts.join("");
  });
}

function columnIndex(reference) {
  const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function worksheetRows(xml, strings) {
  return [...String(xml || "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)].map((rowMatch) => {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const attributes = xmlAttributes(cellMatch[1]);
      const index = columnIndex(attributes.r);
      if (index < 0 || index > 200) continue;
      const body = cellMatch[2];
      const inline = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) => xmlText(match[1])).join("");
      const raw = xmlText(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || "");
      row[index] = attributes.t === "s" ? (strings[Number.parseInt(raw, 10)] || "") : attributes.t === "inlineStr" ? inline : raw;
    }
    return row;
  });
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function formatNumber(value) {
  const normalized = text(value);
  return /^\d+\.0+$/.test(normalized) ? normalized.replace(/\.0+$/, "") : normalized;
}

function fikenContactsFromRows(rows) {
  return rows
    .filter((item) => text(item.Navn))
    .slice(0, MAX_CONTACTS)
    .map((item) => {
      const customerNumber = formatNumber(item.Kundenr);
      const organizationNumber = formatNumber(item.Orgnr);
      const email = text(item["E-post"]) || text(item["Kontaktperson epost"]);
      const phone = formatNumber(item.Telefon) || formatNumber(item["Kontaktperson tlf"]);
      const address = [text(item.Adresse), text(item["Adresse 2"]), [formatNumber(item.Postnr), text(item.Poststed)].filter(Boolean).join(" "), text(item.Land)].filter(Boolean).join(", ");
      const notes = [
        customerNumber && `Fiken kundenummer: ${customerNumber}`,
        organizationNumber && `Organisasjonsnummer: ${organizationNumber}`,
        address && `Adresse: ${address}`,
        text(item.Kundegrupper) && `Kundegrupper: ${text(item.Kundegrupper)}`,
        text(item.Kontaktperson) && `Kontaktperson: ${text(item.Kontaktperson)}`,
        text(item["Kontaktperson epost"]) && `Kontaktperson e-post: ${text(item["Kontaktperson epost"])}`,
        formatNumber(item["Kontaktperson tlf"]) && `Kontaktperson telefon: ${formatNumber(item["Kontaktperson tlf"])}`,
      ].filter(Boolean).join("\n");
      return {
        id: `fiken-customer-${customerNumber}`,
        externalSource: "Fiken",
        externalId: customerNumber,
        name: text(item.Navn),
        email,
        phone,
        company: organizationNumber ? text(item.Navn) : "",
        location: [formatNumber(item.Postnr), text(item.Poststed), text(item.Land)].filter(Boolean).join(" "),
        role: "Fiken-kunde",
        project: "Kunde importert fra Fiken",
        stage: "Ferdig",
        source: "Fiken",
        nextAction: "Ingen aktiv oppfølging",
        preferredContact: email ? "E-post" : phone ? "Telefon" : "Ingen preferanse",
        notes,
        profileCompleted: true,
      };
    });
}

function parseFikenContacts(buffer) {
  const entries = unzipXlsx(buffer);
  const sheetPath = workbookSheetPath(entries);
  const rows = worksheetRows(entries.get(sheetPath), sharedStrings(entries));
  if (rows.length < 2) throw new Error("Fiken-filen inneholder ingen kunder.");
  const headers = rows[0].map(text);
  if (["Navn", "Kundenr"].some((header) => !headers.includes(header))) throw new Error("Filen ser ikke ut som en Fiken-eksport av kunder.");

  const contacts = fikenContactsFromRows(
    rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))),
  );
  if (!contacts.length) throw new Error("Fiken-filen inneholder ingen kunder med navn.");
  return contacts;
}

function decodeXlsxBase64(value) {
  const base64 = String(value || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!base64 || base64.length > Math.ceil(MAX_XLSX_BYTES * 4 / 3) + 8) throw new Error("Filen er for stor eller mangler.");
  return Buffer.from(base64, "base64");
}

module.exports = { MAX_XLSX_BYTES, decodeXlsxBase64, fikenContactsFromRows, parseFikenContacts };
