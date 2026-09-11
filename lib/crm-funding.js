const crypto = require("crypto");

const SOURCES = [
  {
    name: "Kulturdirektoratet – tilskuddsordninger",
    url: "https://www.kulturdirektoratet.no/tilskuddsordninger",
  },
  {
    name: "Kulturrom – bedre lokaler",
    url: "https://kulturrom.no/tilskuddsomraader/bedre-lokaler/",
  },
  {
    name: "Bergen kommune – kulturmidler",
    url: "https://www.bergen.kommune.no/innbyggerhjelpen/kultur-idrett-og-fritid/tilskuddsordninger/kulturmidler/tilskudd-til-profesjonell-kunst-og-kultur",
  },
];

function plainText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&aring;|&#229;/gi, "å")
    .replace(/&oslash;|&#248;/gi, "ø")
    .replace(/&aelig;|&#230;/gi, "æ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateMentions(text) {
  const matches = text.match(/\b(?:[0-3]?\d[.\/-](?:0?\d|1[0-2])[.\/-](?:20)?\d{2}|[0-3]?\d\.?\s+(?:jan(?:uar)?|feb(?:ruar)?|mar(?:s)?|apr(?:il)?|mai|jun(?:i)?|jul(?:i)?|aug(?:ust)?|sep(?:tember)?|okt(?:ober)?|nov(?:ember)?|des(?:ember)?)\s+20\d{2})\b/gi) || [];
  return [...new Set(matches.map((value) => value.trim()))].slice(0, 12);
}

async function inspectSource(source) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(source.url, {
      headers: { "user-agent": "Loki-Lydstudio-Stotteradar/1.0 (+https://www.lokilyd.no)" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = (await response.text()).slice(0, 1_000_000);
    const text = plainText(html);
    return {
      ...source,
      ok: true,
      checkedAt: new Date().toISOString(),
      changedFingerprint: crypto.createHash("sha256").update(text).digest("hex").slice(0, 20),
      deadlineMentions: dateMentions(text),
    };
  } catch (error) {
    return { ...source, ok: false, checkedAt: new Date().toISOString(), error: String(error?.message || "Ukjent feil").slice(0, 160), deadlineMentions: [] };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { SOURCES, dateMentions, inspectSource, plainText };
