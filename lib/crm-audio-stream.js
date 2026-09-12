const { Readable } = require("stream");
const { get } = require("@vercel/blob");

async function streamPrivateBlob(req, res, pathname, filename) {
  const range = String(req.headers.range || "");
  if (range && !/^bytes=\d*-\d*$/.test(range)) return res.status(416).end();
  const result = await get(pathname, {
    access: "private",
    headers: range ? { range } : undefined,
  });
  if (!result || !result.stream) return res.status(404).json({ error: "Lydfilen ble ikke funnet." });

  const forwarded = ["accept-ranges", "content-length", "content-range", "etag", "last-modified"];
  for (const name of forwarded) {
    const value = result.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("content-type", result.blob.contentType || "application/octet-stream");
  res.setHeader("content-disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename || "lydfil")}`);
  res.setHeader("cache-control", "private, no-store, max-age=0");
  res.statusCode = result.headers.get("content-range") ? 206 : 200;
  Readable.fromWeb(result.stream).on("error", () => res.destroy()).pipe(res);
}

module.exports = { streamPrivateBlob };
