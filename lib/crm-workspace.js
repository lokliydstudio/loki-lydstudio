const crypto = require("crypto");

const TASK_PRIORITIES = new Set(["Lav", "Normal", "Høy"]);
const TASK_ASSIGNEES = new Set(["Leon", "Charles", "Begge"]);
const NOTE_TYPES = new Set(["idé", "møte"]);
const GOAL_TYPES = new Set(["Sparemål", "Milepæl"]);

function cleanText(value, max = 500) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function cleanDate(value) {
  const date = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function cleanAmount(value, fallback = 0) {
  const amount = Number(value ?? fallback);
  if (!Number.isFinite(amount)) return 0;
  return Math.min(100_000_000, Math.max(0, Math.round(amount)));
}

function sanitizeTask(input = {}, existing = {}, userEmail = "") {
  const title = cleanText(input.title ?? existing.title, 200);
  if (!title) return null;
  const priority = cleanText(input.priority ?? existing.priority ?? "Normal", 20);
  const assignee = cleanText(input.assignee ?? existing.assignee ?? "Begge", 20);
  return {
    id: cleanText(existing.id || input.id, 120) || `task-${crypto.randomUUID()}`,
    title,
    details: cleanText(input.details ?? existing.details, 2000),
    dueDate: cleanDate(input.dueDate ?? existing.dueDate),
    priority: TASK_PRIORITIES.has(priority) ? priority : "Normal",
    assignee: TASK_ASSIGNEES.has(assignee) ? assignee : "Begge",
    completed: Boolean(input.completed ?? existing.completed ?? false),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(userEmail, 254),
  };
}

function sanitizeNote(input = {}, existing = {}, userEmail = "") {
  const type = cleanText(input.type ?? existing.type ?? "idé", 20).toLowerCase();
  const title = cleanText(input.title ?? existing.title, 200);
  const content = cleanText(input.content ?? existing.content, 12000);
  if (!title || !content) return null;
  return {
    id: cleanText(existing.id || input.id, 120) || `note-${crypto.randomUUID()}`,
    type: NOTE_TYPES.has(type) ? type : "idé",
    title,
    content,
    date: cleanDate(input.date ?? existing.date) || new Date().toISOString().slice(0, 10),
    attendees: cleanText(input.attendees ?? existing.attendees, 500),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(userEmail, 254),
  };
}

function sanitizeGoal(input = {}, existing = {}, userEmail = "") {
  const title = cleanText(input.title ?? existing.title, 200);
  if (!title) return null;
  const type = cleanText(input.type ?? existing.type ?? "Sparemål", 30);
  const targetAmount = cleanAmount(input.targetAmount, existing.targetAmount);
  const currentAmount = cleanAmount(input.currentAmount, existing.currentAmount);
  const progress = targetAmount > 0 ? Math.min(100, Math.round((currentAmount / targetAmount) * 100)) : 0;
  const completed = Boolean(input.completed ?? existing.completed) || (targetAmount > 0 && currentAmount >= targetAmount);
  return {
    id: cleanText(existing.id || input.id, 120) || `goal-${crypto.randomUUID()}`,
    title,
    type: GOAL_TYPES.has(type) ? type : "Sparemål",
    targetAmount,
    currentAmount,
    progress,
    targetDate: cleanDate(input.targetDate ?? existing.targetDate),
    note: cleanText(input.note ?? existing.note, 3000),
    completed,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(userEmail, 254),
  };
}

module.exports = { sanitizeGoal, sanitizeNote, sanitizeTask };
