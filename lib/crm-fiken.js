const crypto = require("crypto");

const BASE_URL = "https://api.fiken.no/api/v2";

function configured() {
  return Boolean(process.env.FIKEN_API_TOKEN);
}

async function fikenGet(pathname) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: {
      authorization: `Bearer ${process.env.FIKEN_API_TOKEN}`,
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
  if (!configured()) return { connected: false, setupRequired: true, readOnly: true };
  const companies = await fikenGet("/companies?page=0&pageSize=100&sortBy=name%20asc");
  const preferredSlug = String(process.env.FIKEN_COMPANY_SLUG || "").trim();
  const company = companies.find((item) => (item.slug || item.companySlug) === preferredSlug) || companies[0];
  if (!company) throw new Error("Fant ingen foretak i Fiken-kontoen.");
  const slug = encodeURIComponent(company.slug || company.companySlug);
  // Fiken tillater bare én samtidig API-forespørsel, derfor kjøres kallene sekvensielt.
  const invoices = await fikenGet(`/companies/${slug}/invoices?page=0&pageSize=100`);
  const contacts = await fikenGet(`/companies/${slug}/contacts?page=0&pageSize=100&sortBy=lastModified%20desc`);
  return summarizeFiken(company, invoices, contacts);
}

module.exports = { amountInOre, configured, loadFikenSummary, summarizeFiken };
