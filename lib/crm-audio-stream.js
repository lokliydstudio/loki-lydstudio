const { Readable } = require("stream");
const { get } = require("@vercel/blob");

async function streamPrivateBlob(req, res, pathname, filename, options = {}) {
  const range = String(req.headers.range || "");
  if (range && !/^bytes=\d*-\d*$/.test(range)) return res.status(416).end();
  const result = await get(pathname, {
    access: "private",
    headers: range ? { range } : undefined,
  });
  if (!result || !result.stream) return res.status(404).json({ error: options.notFoundMessage || "Filen ble ikke funnet." });

  const forwarded = ["accept-ranges", "content-length", "content-range", "etag", "last-modified"];
  for (const name of forwarded) {
    const value = result.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("content-type", result.blob.contentType || "application/octet-stream");
  const disposition = options.download ? "attachment" : "inline";
  res.setHeader("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(filename || "fil")}`);
  res.setHeader("cache-control", "private, no-store, max-age=0");
  res.statusCode = result.headers.get("content-range") ? 206 : 200;
  Readable.fromWeb(result.stream).on("error", () => res.destroy()).pipe(res);
}

module.exports = { streamPrivateBlob };
