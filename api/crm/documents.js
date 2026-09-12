const { head, issueSignedToken } = require("@vercel/blob");
const { handleUploadPresigned } = require("@vercel/blob/client");
const { currentUser } = require("../../lib/crm-auth");
const { bridgeAuthorized } = require("../../lib/crm-bridge");
const {
  MAX_DOCUMENT_SIZE,
  blocked,
  documentContentType,
  documentPathname,
  mergeDocumentIndex,
  publicDocument,
  sanitizeUploadedDocument,
  validDocumentId,
} = require("../../lib/crm-documents");
const { streamPrivateBlob } = require("../../lib/crm-audio-stream");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");

function parsePayload(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    throw new Error("Ugyldig dokumentdata.");
  }
}

async function uploadHandler(req, res, user) {
  if (!user) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const result = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        const id = validDocumentId(payload.id);
        const expected = documentPathname(id, payload.name);
        const size = Number(payload.size);
        if (!expected || pathname !== expected || blocked(payload.path || payload.name)) throw new Error("Filtypen eller filstien er ikke tillatt.");
        if (!Number.isFinite(size) || size < 0 || size > MAX_DOCUMENT_SIZE) throw new Error("Dokumentet kan være maksimalt 500 MB.");
        const documents = await readCollection("documents");
        const existing = documents.find((document) => document.id === id);
        if (existing && String(existing.name || "").toLowerCase() !== String(payload.name || "").toLowerCase()) {
          throw new Error("Filen matcher ikke den valgte dokumentraden.");
        }

        const allowedContentTypes = [documentContentType(payload.name)];
        const validUntil = Date.now() + 15 * 60 * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes,
          maximumSizeInBytes: MAX_DOCUMENT_SIZE,
          validUntil,
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes,
            maximumSizeInBytes: MAX_DOCUMENT_SIZE,
            validUntil,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Document upload signing failed", error?.message);
    return res.status(400).json({ error: error?.message || "Kunne ikke starte dokumentopplastingen." });
  }
}

async function downloadHandler(req, res, user) {
  if (!user) return res.status(401).json({ error: "Innlogging kreves." });
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const documents = await readCollection("documents");
  const id = validDocumentId(req.query?.id);
  const document = documents.find((item) => item.id === id);
  if (!document?.pathname) return res.status(404).json({ error: "Dokumentfilen er ikke lastet opp ennå." });
  return streamPrivateBlob(req, res, document.pathname, document.name, {
    download: String(req.query?.download || "") === "1",
    notFoundMessage: "Dokumentfilen ble ikke funnet.",
  });
}

async function registerUpload(req, res, user) {
  const input = req.body?.document || {};
  const id = validDocumentId(input.id);
  const pathname = documentPathname(id, input.name);
  if (!pathname || pathname !== input.pathname) return res.status(400).json({ error: "Ugyldig dokumentdata." });
  const actualBlob = await head(pathname, { access: "private" });
  const documents = await readCollection("documents");
  const index = documents.findIndex((document) => document.id === id);
  const document = sanitizeUploadedDocument(input, actualBlob, user.email, index >= 0 ? documents[index] : {});
  if (!document) return res.status(400).json({ error: "Dokumentfilen kunne ikke verifiseres." });
  if (index >= 0) documents[index] = document;
  else documents.unshift(document);
  await writeCollection("documents", documents);
  return res.status(201).json({ document: publicDocument(document) });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const user = currentUser(req);
  const bridge = bridgeAuthorized(req);
  const action = String(req.query?.action || "");
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (action === "upload") return await uploadHandler(req, res, user);
    if (action === "download") return await downloadHandler(req, res, user);
    if (!user && !bridge) return res.status(401).json({ error: "Innlogging kreves." });

    if (req.method === "GET") {
      if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
      const documents = await readCollection("documents");
      return res.status(200).json({ documents: documents.map(publicDocument) });
    }

    if (req.method === "POST" && req.body?.operation === "register") {
      if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
      return await registerUpload(req, res, user);
    }

    if (req.method === "POST") {
      if (!bridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      const input = Array.isArray(req.body?.documents) ? req.body.documents.slice(0, 5000) : [];
      const existing = await readCollection("documents");
      const documents = mergeDocumentIndex(input, existing);
      await writeCollection("documents", documents);
      return res.status(200).json({ ok: true, count: documents.length });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(`Document storage failed (${action || "index"})`, error?.message);
    return res.status(503).json({ error: "Kunne ikke fullføre dokumenthandlingen." });
  }
};
