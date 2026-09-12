const { requireUser } = require("../../lib/crm-auth");
const { isConfigured, readCollection, writeCollection } = require("../../lib/crm-store");
const { cleanText, sanitizeProject } = require("../../lib/crm-projects");

module.exports = async function handler(req, res) {
  if (!requireUser(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ error: "CRM-lagringen er ikke aktivert ennå." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ projects: await readCollection("projects") });
    }

    if (req.method === "POST") {
      const projects = await readCollection("projects");
      const project = sanitizeProject(req.body?.project || req.body || {});
      projects.unshift(project);
      await writeCollection("projects", projects);
      return res.status(201).json({ project });
    }

    if (req.method === "PATCH") {
      const projects = await readCollection("projects");
      const id = cleanText(req.body?.id, 120);
      const index = projects.findIndex((project) => project.id === id);
      if (index < 0) return res.status(404).json({ error: "Prosjektet ble ikke funnet." });
      projects[index] = sanitizeProject(req.body?.changes || {}, projects[index]);
      await writeCollection("projects", projects);
      return res.status(200).json({ project: projects[index] });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("CRM project storage failed", error?.message);
    return res.status(503).json({ error: "Kunne ikke oppdatere studioprosjektet." });
  }
};
