const { head, issueSignedToken } = require("@vercel/blob");
const { handleUploadPresigned } = require("@vercel/blob/client");
const { currentUser } = require("../../lib/crm-auth");
const { bridgeAuthorized, fileBridgeAuthorized } = require("../../lib/crm-bridge");
const {
  MAX_DOCUMENT_SIZE,
  blocked,
  documentContentType,
  documentPathname,
  mergeDocumentIndex,
  publicDocument,
  publicDocumentsWithOpens,
  recordDocumentOpen,
  safeRelativePath,
  sanitizeUploadedDocument,
  uploadArchivePath,
  validDocumentId,
} = require("../../lib/crm-documents");
const { streamPrivateBlob } = require("../../lib/crm-audio-stream");
const { isConfigured, mutateCollection, readCollection } = require("../../lib/crm-store");

function parsePayload(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    throw new Error("Ugyldig dokumentdata.");
  }
}

async function uploadHandler(req, res, user, bridge) {
  if (!user && !bridge) return res.status(401).json({ error: "Innlogging kreves." });
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
        if (bridge) {
          if (!payload.bridgeImport || !existing || existing.source === "upload" || !existing.jottaImportRequestedAt || payload.path !== existing.path) {
            throw new Error("Jottacloud-importen er ikke bestilt.");
          }
        } else if (payload.bridgeImport || payload.path !== (existing?.path || uploadArchivePath(id, payload.name))) {
          throw new Error("Ugyldig Jottacloud-sti.");
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
  const download = String(req.query?.download || "") === "1";
  return streamPrivateBlob(req, res, document.pathname, document.name, {
    download,
    notFoundMessage: "Dokumentfilen ble ikke funnet.",
    onReady: !download && !req.headers.range ? async () => {
      try { await saveDocumentOpen(id, user.email); }
      catch (error) { console.error("Document open tracking failed", error?.message); }
    } : undefined,
  });
}

async function saveDocumentOpen(id, email) {
  const recent = await readCollection("document-opens");
  const previous = recent.find((item) => item.id === id && item.openedBy === email);
  if (previous && Date.now() - Date.parse(previous.openedAt) < 30_000) return previous.openedAt;
  const openedAt = new Date().toISOString();
  await mutateCollection("document-opens", (opens) => ({
    items: recordDocumentOpen(opens, id, email, openedAt),
    result: openedAt,
  }));
  return openedAt;
}

async function markExternalOpen(req, res, user) {
  if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const id = validDocumentId(req.body?.id);
  const documents = await readCollection("documents");
  const document = documents.find((item) => item.id === id);
  if (!document?.path) return res.status(404).json({ error: "Dokumentet ble ikke funnet." });
  const openedAt = await saveDocumentOpen(id, user.email);
  return res.status(200).json({ id, lastOpenedAt: openedAt });
}

async function bridgeDownloadHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const id = validDocumentId(req.query?.id);
  const document = (await readCollection("documents")).find((item) => item.id === id);
  if (!document?.pathname || document.source !== "upload" || document.jottaState !== "pending") {
    return res.status(404).json({ error: "Ingen synkronisering venter for filen." });
  }
  return streamPrivateBlob(req, res, document.pathname, document.name, { download: true });
}

async function bridgeJobsHandler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const documents = await readCollection("documents");
  return res.status(200).json({
    uploads: documents.filter((item) => item.source === "upload" && item.pathname && item.jottaState === "pending")
      .slice(0, 20).map((item) => ({
        id: item.id, name: item.name, path: uploadArchivePath(item.id, item.name),
        size: item.size, version: item.uploadedAt,
        downloadPath: `/api/crm/documents?action=bridge-download&id=${encodeURIComponent(item.id)}`,
      })),
    imports: documents.filter((item) => item.source !== "upload" && item.jottaImportRequestedAt)
      .slice(0, 20).map((item) => ({
        id: item.id, name: item.name, path: item.path, size: item.size,
        version: item.jottaImportRequestedAt,
        pathname: documentPathname(item.id, item.name),
      })),
  });
}

async function requestImport(req, res, user) {
  if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
  const id = validDocumentId(req.body?.id);
  const change = await mutateCollection("documents", (documents) => {
    const document = documents.find((item) => item.id === id);
    if (!document || document.source === "upload" || !safeRelativePath(document.path)) {
      return { error: "Dokumentet kan ikke hentes fra Jottacloud." };
    }
    if (document.size > MAX_DOCUMENT_SIZE) return { error: "Filen er over 500 MB og må hentes i Jottacloud." };
    if (!documentPathname(document.id, document.name)) return { error: "Denne filtypen kan bare åpnes i Jottacloud." };
    document.jottaImportRequestedAt = new Date().toISOString();
    document.jottaError = "";
    return { items: documents, result: publicDocument(document) };
  });
  if (change.error) return res.status(400).json({ error: change.error });
  return res.status(200).json({ document: change.result });
}

async function retrySync(req, res, user) {
  if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
  const id = validDocumentId(req.body?.id);
  const change = await mutateCollection("documents", (documents) => {
    const document = documents.find((item) => item.id === id);
    if (!document?.pathname || document.source !== "upload" || document.jottaState !== "error") {
      return { error: "Ingen feilet synkronisering å prøve igjen." };
    }
    document.jottaState = "pending";
    document.jottaError = "";
    return { items: documents, result: publicDocument(document) };
  });
  if (change.error) return res.status(400).json({ error: change.error });
  return res.status(200).json({ document: change.result });
}

async function bridgeResult(req, res) {
  const id = validDocumentId(req.body?.id);
  const kind = String(req.body?.kind || "");
  const version = String(req.body?.version || "");
  const success = req.body?.success === true;
  if (!id || !["upload", "import"].includes(kind) || !version) return res.status(400).json({ error: "Ugyldig broresultat." });
  const current = kind === "import" && success ? (await readCollection("documents")).find((item) => item.id === id) : null;
  const actualBlob = current && current.name === req.body?.name
    ? await head(documentPathname(id, current.name), { access: "private" }) : null;
  const change = await mutateCollection("documents", (documents) => {
    const document = documents.find((item) => item.id === id);
    if (!document || (kind === "upload" ? document.source !== "upload" || document.uploadedAt !== version || document.jottaState !== "pending"
      : document.source === "upload" || document.jottaImportRequestedAt !== version)) {
      return { error: "Brojobben er ikke lenger aktuell." };
    }
    if (success && kind === "import") {
      const expected = documentPathname(id, document.name);
      if (!actualBlob || actualBlob.pathname !== expected || Number(actualBlob.size) > MAX_DOCUMENT_SIZE) {
        return { error: "Den importerte filen kunne ikke verifiseres." };
      }
      document.pathname = expected;
      document.size = Number(actualBlob.size) || 0;
      document.contentType = actualBlob.contentType || documentContentType(document.name);
      document.uploadedAt = new Date().toISOString();
      document.uploadedBy = "jottacloud-bro";
      document.jottaImportRequestedAt = null;
    }
    if (!success && kind === "import") document.jottaImportRequestedAt = null;
    if (kind === "upload") document.jottaState = success ? "synced" : "error";
    document.jottaError = success ? "" : String(req.body?.error || "Ukjent feil").slice(0, 180);
    if (success) document.jottaSyncedAt = new Date().toISOString();
    return { items: documents, result: publicDocument(document) };
  });
  if (change.error) return res.status(409).json({ error: change.error });
  return res.status(200).json({ document: change.result });
}

async function registerUpload(req, res, user) {
  const input = req.body?.document || {};
  const id = validDocumentId(input.id);
  const pathname = documentPathname(id, input.name);
  if (!pathname || pathname !== input.pathname) return res.status(400).json({ error: "Ugyldig dokumentdata." });
  const actualBlob = await head(pathname, { access: "private" });
  const change = await mutateCollection("documents", (documents) => {
    const index = documents.findIndex((document) => document.id === id);
    const document = sanitizeUploadedDocument(input, actualBlob, user.email, index >= 0 ? documents[index] : {});
    if (!document) return { error: "Dokumentfilen kunne ikke verifiseres." };
    if (index >= 0) documents[index] = document;
    else documents.unshift(document);
    return { items: documents, result: publicDocument(document) };
  });
  if (change.error) return res.status(400).json({ error: change.error });
  return res.status(201).json({ document: change.result });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const user = currentUser(req);
  const bridge = bridgeAuthorized(req);
  const fileBridge = bridge || fileBridgeAuthorized(req);
  const action = String(req.query?.action || "");
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (action === "upload") return await uploadHandler(req, res, user, fileBridge);
    if (action === "download") return await downloadHandler(req, res, user);
    if (action === "opened") return await markExternalOpen(req, res, user);
    if (action === "bridge-download") {
      if (!fileBridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      return await bridgeDownloadHandler(req, res);
    }
    if (action === "bridge-jobs") {
      if (!fileBridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      return await bridgeJobsHandler(req, res);
    }
    if (!user && !fileBridge) return res.status(401).json({ error: "Innlogging kreves." });

    if (req.method === "GET") {
      if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
      const [documents, opens] = await Promise.all([readCollection("documents"), readCollection("document-opens")]);
      return res.status(200).json({ documents: publicDocumentsWithOpens(documents, opens) });
    }

    if (req.method === "POST" && req.body?.operation === "register") {
      if (!user) return res.status(403).json({ error: "Brukerinnlogging kreves." });
      return await registerUpload(req, res, user);
    }
    if (req.method === "POST" && req.body?.operation === "import") return await requestImport(req, res, user);
    if (req.method === "POST" && req.body?.operation === "retry-sync") return await retrySync(req, res, user);
    if (req.method === "POST" && req.body?.operation === "bridge-result") {
      if (!fileBridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      return await bridgeResult(req, res);
    }

    if (req.method === "POST") {
      if (!fileBridge) return res.status(403).json({ error: "Ugyldig brotilgang." });
      const input = Array.isArray(req.body?.documents) ? req.body.documents.slice(0, 5000) : [];
      const change = await mutateCollection("documents", (existing) => {
        const documents = mergeDocumentIndex(input, existing);
        return { items: documents, result: documents.length };
      });
      return res.status(200).json({ ok: true, count: change.result });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error(`Document storage failed (${action || "index"})`, error?.message);
    return res.status(503).json({ error: "Kunne ikke fullføre dokumenthandlingen." });
  }
};
