const crypto = require("crypto");
const { cleanText } = require("./crm-audio");

const MAX_COMMENT_SECONDS = 12 * 60 * 60;
const MAX_COMMENTS_PER_TRACK = 250;

function cleanTimestamp(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 0;
  return Math.round(Math.max(0, Math.min(seconds, MAX_COMMENT_SECONDS)) * 10) / 10;
}

function internalAuthorName(email) {
  const local = String(email || "").split("@")[0].toLowerCase();
  if (local === "leon") return "Leon";
  if (local === "charles") return "Charles";
  return "Loki Lydstudio";
}

function sanitizeAudioComment(input, actor = {}) {
  const trackId = cleanText(input?.trackId, 80);
  const body = cleanText(input?.body, 1000);
  const authorType = actor.type === "studio" ? "studio" : "customer";
  const authorName = authorType === "studio"
    ? internalAuthorName(actor.email)
    : cleanText(input?.authorName, 80);
  if (!/^track-[0-9a-f-]{36}$/.test(trackId) || !body || !authorName) return null;

  return {
    id: `comment-${crypto.randomUUID()}`,
    trackId,
    timestampSeconds: cleanTimestamp(input?.timestampSeconds),
    body,
    authorName,
    authorType,
    createdAt: new Date().toISOString(),
  };
}

function publicAudioComment(comment) {
  return {
    id: cleanText(comment?.id, 80),
    trackId: cleanText(comment?.trackId, 80),
    timestampSeconds: cleanTimestamp(comment?.timestampSeconds),
    body: cleanText(comment?.body, 1000),
    authorName: cleanText(comment?.authorName, 80),
    authorType: comment?.authorType === "studio" ? "studio" : "customer",
    createdAt: cleanText(comment?.createdAt, 40),
  };
}

function commentsForTrack(comments, trackId) {
  return comments
    .filter((comment) => comment.trackId === trackId)
    .map(publicAudioComment)
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds || String(left.createdAt).localeCompare(String(right.createdAt)));
}

module.exports = {
  MAX_COMMENTS_PER_TRACK,
  cleanTimestamp,
  commentsForTrack,
  internalAuthorName,
  publicAudioComment,
  sanitizeAudioComment,
};
