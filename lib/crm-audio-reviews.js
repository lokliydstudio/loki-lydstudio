const crypto = require("crypto");
const { cleanText } = require("./crm-audio");
const { publicAudioComment } = require("./crm-audio-comments");

const DELIVERY_STATUSES = Object.freeze({
  awaiting_feedback: "Avventer tilbakemelding",
  changes_requested: "Endringer ønsket",
  under_revision: "Under revisjon",
  approved: "Godkjent",
});

const REVIEW_ACTIONS = new Set(["approve", "request_changes"]);

function normalizeDeliveryStatus(value, fallback = "awaiting_feedback") {
  const status = cleanText(value, 40).toLowerCase();
  return Object.hasOwn(DELIVERY_STATUSES, status) ? status : fallback;
}

function cleanClientRequestId(value) {
  const id = cleanText(value, 100);
  return /^[a-zA-Z0-9_-]{8,100}$/.test(id) ? id : "";
}

function sanitizeCommentSnapshots(comments, trackId) {
  return (Array.isArray(comments) ? comments : [])
    .filter((comment) => comment?.trackId === trackId && comment?.authorType !== "studio")
    .slice(0, 250)
    .map(publicAudioComment);
}

function sanitizeAudioReview(input = {}, context = {}) {
  const track = context.track || {};
  const action = cleanText(input.action, 30);
  const customerName = cleanText(input.customerName, 80);
  const message = cleanText(input.message, 3000);
  const clientRequestId = cleanClientRequestId(input.clientRequestId);
  if (!REVIEW_ACTIONS.has(action) || !customerName || !clientRequestId || !/^track-[0-9a-f-]{36}$/.test(String(track.id || ""))) return null;
  if (action === "request_changes" && !message) return null;
  const createdAt = new Date().toISOString();
  return {
    id: `review-${crypto.randomUUID()}`,
    clientRequestId,
    trackId: track.id,
    projectId: cleanText(track.projectId, 120),
    mixGroupId: cleanText(track.mixGroupId, 80),
    audioTitle: cleanText(track.title || track.filename, 160),
    filename: cleanText(track.filename, 180),
    version: cleanText(track.version || "V1", 40),
    action,
    status: action === "approve" ? "approved" : "changes_requested",
    customerName,
    message,
    comments: sanitizeCommentSnapshots(context.comments, track.id),
    createdAt,
  };
}

function publicAudioReview(review) {
  const status = normalizeDeliveryStatus(review?.status, review?.action === "approve" ? "approved" : "changes_requested");
  return {
    id: cleanText(review?.id, 80),
    trackId: cleanText(review?.trackId, 80),
    projectId: cleanText(review?.projectId, 120),
    mixGroupId: cleanText(review?.mixGroupId, 80),
    audioTitle: cleanText(review?.audioTitle, 160),
    filename: cleanText(review?.filename, 180),
    version: cleanText(review?.version || "V1", 40),
    action: review?.action === "approve" ? "approve" : "request_changes",
    status,
    statusLabel: DELIVERY_STATUSES[status],
    customerName: cleanText(review?.customerName, 80),
    message: cleanText(review?.message, 3000),
    comments: sanitizeCommentSnapshots(review?.comments, cleanText(review?.trackId, 80)),
    createdAt: cleanText(review?.createdAt, 40),
  };
}

function reviewsForTrack(reviews, trackId) {
  return (Array.isArray(reviews) ? reviews : [])
    .filter((review) => review?.trackId === trackId)
    .map(publicAudioReview)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function decideAudioReview(items, review, now = Date.now()) {
  const existingItems = Array.isArray(items) ? items : [];
  const trackReviews = existingItems.filter((item) => item.trackId === review.trackId);
  const sameRequest = trackReviews.find((item) => item.clientRequestId === review.clientRequestId);
  if (sameRequest) return { items: existingItems, result: { review: sameRequest, created: false } };
  const existingApproval = trackReviews.find((item) => item.action === "approve" || item.status === "approved");
  if (existingApproval) {
    if (review.action === "approve") return { items: existingItems, result: { review: existingApproval, created: false } };
    return { error: { status: 409, message: "Denne versjonen er allerede godkjent. En ny lydfil må lastes opp som ny versjon." } };
  }
  const recentDuplicate = trackReviews.find((item) => item.action === review.action
    && item.customerName === review.customerName
    && item.message === review.message
    && now - new Date(item.createdAt).getTime() < 30_000);
  if (recentDuplicate) return { items: existingItems, result: { review: recentDuplicate, created: false } };
  return { items: [review, ...existingItems].slice(0, 10_000), result: { review, created: true } };
}

function reviewStateForTrack(track = {}, reviews = []) {
  const history = reviewsForTrack(reviews, track.id);
  const latest = history[0] || null;
  const storedStatus = normalizeDeliveryStatus(track.deliveryStatus);
  const storedAt = new Date(track.reviewUpdatedAt || 0).getTime() || 0;
  const latestAt = new Date(latest?.createdAt || 0).getTime() || 0;
  const status = latest && latestAt >= storedAt ? latest.status : storedStatus;
  return {
    status,
    statusLabel: DELIVERY_STATUSES[status],
    latestReview: latest,
    history,
  };
}

function decorateTrackWithReviewState(track, reviews = []) {
  const reviewState = reviewStateForTrack(track, reviews);
  return { ...track, deliveryStatus: reviewState.status, reviewState };
}

module.exports = {
  DELIVERY_STATUSES,
  cleanClientRequestId,
  decideAudioReview,
  decorateTrackWithReviewState,
  normalizeDeliveryStatus,
  publicAudioReview,
  reviewStateForTrack,
  reviewsForTrack,
  sanitizeAudioReview,
};
