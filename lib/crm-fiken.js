const crypto = require("crypto");
const { readCollection, writeCollection } = require("./crm-store");

const BASE_URL = "https://api.fiken.no/api/v2";
const AUTHORIZE_URL = "https://fiken.no/oauth/authorize";
const TOKEN_URL = "https://fiken.no/oauth/token";

function configured() {
  return Boolean(process.env.FIKEN_API_TOKEN || oauthConfigured());
}

function oauthConfigured() {
  return Boolean(process.env.FIKEN_CLIENT_ID && process.env.FIKEN_CLIENT_SECRET);
}

function encryptionKey() {
  if (!process.env.CRM_AUTH_SECRET) throw new Error("CRM_AUTH_SECRET mangler.");
  return crypto.createHash("sha256").update(`loki-fiken:${process.env.CRM_AUTH_SECRET}`).digest();
}

function sealGrant(grant) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(grant), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function openGrant(value) {
  const [iv, tag, ciphertext] = String(value || "").split(".").map((part) => Buffer.from(part || "", "base64url"));
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

async function saveGrant(grant) {
  const expiresAt = Date.now() + Math.max(60, Number(grant.expires_in) || 3600) * 1000;
  await writeCollection("fiken-auth", [{ sealed: sealGrant({ ...grant, expiresAt }), updatedAt: new Date().toISOString() }]);
  return { ...grant, expiresAt };
}

async function tokenRequest(parameters) {
  const credentials = Buffer.from(`${process.env.FIKEN_CLIENT_ID}:${process.env.FIKEN_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(parameters).toString(),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`Fiken-autorisasjon feilet${data.error_description ? `: ${String(data.error_description).slice(0, 180)}` : ""}`);
  return data;
}

async function exchangeAuthorizationCode(code, redirectUri, state) {
  if (!oauthConfigured()) throw new Error("Fiken OAuth er ikke konfigurert.");
  const grant = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, state });
  return saveGrant(grant);
}

async function storedOAuthGrant() {
  if (!oauthConfigured()) return null;
  const record = (await readCollection("fiken-auth"))[0];
  if (!record?.sealed) return null;
  const grant = openGrant(record.sealed);
  if (!grant?.access_token) return null;
  if (Number(grant.expiresAt) > Date.now() + 60_000) return grant;
  if (!grant.refresh_token) return null;
  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: grant.refresh_token });
  return saveGrant({ ...refreshed, refresh_token: refreshed.refresh_token || grant.refresh_token });
}

function authorizationUrl(redirectUri, state) {
  if (!oauthConfigured()) return "";
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.FIKEN_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

async function accessToken() {
  if (process.env.FIKEN_API_TOKEN) return process.env.FIKEN_API_TOKEN;
  return (await storedOAuthGrant())?.access_token || "";
}

async function fikenGet(pathname, token) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": crypto.randomUUID(),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Fiken svarte med HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json();
}

function amountInOre(invoice = {}) {
  const direct = [invoice.gross, invoice.grossAmount, invoice.total, invoice.amount].find(Number.isFinite);
  if (Number.isFinite(direct)) return direct;
  if (Array.isArray(invoice.lines)) {
    return invoice.lines.reduce((sum, line) => sum + (Number(line.grossAmount ?? line.gross) || 0), 0);
  }
  return 0;
}

function summarizeFiken(company, invoices = [], contacts = []) {
  const today = new Date().toISOString().slice(0, 10);
  const orderedInvoices = [...invoices].sort((left, right) => String(right.issueDate || "").localeCompare(String(left.issueDate || "")));
  const unpaid = orderedInvoices.filter((invoice) => !invoice.settled);
  const overdue = unpaid.filter((invoice) => invoice.dueDate && invoice.dueDate < today);
  return {
    connected: true,
    company: {
      name: company?.name || "Fiken-foretak",
      slug: company?.slug || company?.companySlug || "",
      organizationNumber: company?.organizationNumber || "",
    },
    metrics: {
      invoiceCount: invoices.length,
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      outstandingOre: unpaid.reduce((sum, invoice) => sum + amountInOre(invoice), 0),
      contactCount: contacts.length,
    },
    invoices: orderedInvoices.slice(0, 12).map((invoice) => ({
      id: invoice.invoiceId || invoice.id,
      number: invoice.invoiceNumber || "–",
      customer: invoice.customer?.name || invoice.customerName || "Ukjent kunde",
      issueDate: invoice.issueDate || "",
      dueDate: invoice.dueDate || "",
      settled: Boolean(invoice.settled),
      grossOre: amountInOre(invoice),
    })),
    fetchedAt: new Date().toISOString(),
    readOnly: true,
  };
}

async function loadFikenSummary() {
  if (!configured()) return { connected: false, setupRequired: true, oauthConfigured: false, readOnly: true };
  const token = await accessToken();
  if (!token) return { connected: false, authorizationRequired: true, oauthConfigured: true, readOnly: true };
  const companies = await fikenGet("/companies?page=0&pageSize=100&sortBy=name%20asc", token);
  const preferredSlug = String(process.env.FIKEN_COMPANY_SLUG || "").trim();
  const company = companies.find((item) => (item.slug || item.companySlug) === preferredSlug) || companies[0];
  if (!company) throw new Error("Fant ingen foretak i Fiken-kontoen.");
  const slug = encodeURIComponent(company.slug || company.companySlug);
  // Fiken tillater bare én samtidig API-forespørsel, derfor kjøres kallene sekvensielt.
  const invoices = await fikenGet(`/companies/${slug}/invoices?page=0&pageSize=100`, token);
  const contacts = await fikenGet(`/companies/${slug}/contacts?page=0&pageSize=100&sortBy=lastModified%20desc`, token);
  return summarizeFiken(company, invoices, contacts);
}

module.exports = { amountInOre, authorizationUrl, configured, exchangeAuthorizationCode, loadFikenSummary, oauthConfigured, openGrant, sealGrant, summarizeFiken };
