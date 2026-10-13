const { RECEIPT_CATEGORIES } = require("./crm-receipts");

function responseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  return (response?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text").map((item) => item.text).join("\n");
}

function scanCredentials(options = {}) {
  const directOpenAi = Boolean(process.env.OPENAI_API_KEY);
  return {
    directOpenAi,
    apiKey: process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || options.oidcToken || "",
  };
}

function scanConfigured(options = {}) {
  return Boolean(scanCredentials(options).apiKey);
}

function scanFailure(status, detail) {
  const error = new Error(`Bilagsskanning feilet (${status})${detail ? `: ${detail}` : ""}`);
  error.publicMessage = status === 429
    ? "Skannetjenesten har for mange forespørsler akkurat nå. Prøv igjen om litt."
    : status === 403
      ? "AI-modellen for bilagsskanning er ikke tilgjengelig i Vercel-oppsettet."
      : "Bilaget kunne ikke skannes akkurat nå. Du kan fortsatt fylle inn feltene manuelt.";
  return error;
}

async function scanReceipt({ buffer, contentType, filename, oidcToken }) {
  const { directOpenAi, apiKey } = scanCredentials({ oidcToken });
  if (!apiKey) throw scanFailure(503, "AI Gateway/OIDC eller OPENAI_API_KEY mangler");
  const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
  const attachment = contentType === "application/pdf"
    ? { type: "input_file", filename, file_data: dataUrl }
    : { type: "input_image", image_url: dataUrl, detail: "high" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["supplier", "receiptDate", "totalOre", "vatOre", "currency", "receiptNumber", "organizationNumber", "category", "paymentMethod", "confidence", "warnings"],
    properties: {
      supplier: { type: "string" },
      receiptDate: { type: "string" },
      totalOre: { type: "integer", minimum: 0 },
      vatOre: { type: "integer", minimum: 0 },
      currency: { type: "string" },
      receiptNumber: { type: "string" },
      organizationNumber: { type: "string" },
      category: { type: "string", enum: RECEIPT_CATEGORIES },
      paymentMethod: { type: "string" },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      warnings: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  };
  const prompt = "Les dette bilaget nøyaktig. Hent bare informasjon som faktisk er synlig. Ikke gjett. Dato skal være YYYY-MM-DD eller tom streng. totalOre er totalbeløpet inkludert MVA i øre, vatOre er MVA i øre. Bruk 0 når beløpet ikke kan leses. Bruk normalt NOK. Velg nærmeste kategori. Legg uklarheter, manglende sider og mulig duplikat/ufullstendig kvittering i warnings. Dette er datafangst, ikke regnskapsråd; en bruker skal kontrollere resultatet før godkjenning.";
  const response = await fetch(directOpenAi ? "https://api.openai.com/v1/responses" : "https://ai-gateway.vercel.sh/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.RECEIPT_SCAN_MODEL || (directOpenAi ? "gpt-5-mini" : "openai/gpt-5-mini"),
      store: false,
      max_output_tokens: 1600,
      reasoning: { effort: "low" },
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }, attachment] }],
      text: { format: { type: "json_schema", name: "receipt_scan", strict: true, schema } },
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw scanFailure(response.status, String(failure?.error?.message || failure?.error || "").slice(0, 300));
  }
  const parsed = JSON.parse(responseText(await response.json()));
  return parsed;
}

module.exports = { responseText, scanConfigured, scanReceipt };
