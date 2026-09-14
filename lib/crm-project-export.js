const { commentsForTrack } = require("./crm-audio-comments");

function publicTrack(track, comments = []) {
  return {
    id: track.id,
    projectId: track.projectId,
    filename: track.filename,
    title: track.title,
    version: track.version,
    notes: track.notes,
    size: Number(track.size) || 0,
    contentType: track.contentType,
    uploadedAt: track.uploadedAt,
    jottaStatus: track.jottaStatus,
    jottaSyncedAt: track.jottaSyncedAt,
    comments: commentsForTrack(comments, track.id),
  };
}

function createProjectExport(projects, tracks, requestedId = "", comments = []) {
  const selectedProjects = requestedId
    ? projects.filter((project) => project.id === requestedId)
    : projects;
  if (requestedId && selectedProjects.length === 0) return null;

  const projectIds = new Set(selectedProjects.map((project) => project.id));
  const selectedTracks = tracks.filter((track) => projectIds.has(track.projectId));

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    scope: requestedId ? "project" : "all-projects",
    studio: "Loki Lydstudio",
    containsPersonalData: true,
    projects: selectedProjects.map((project) => ({
      ...project,
      tracks: selectedTracks
        .filter((track) => track.projectId === project.id)
        .map((track) => publicTrack(track, comments)),
    })),
    files: selectedTracks.map((track) => ({
      trackId: track.id,
      projectId: track.projectId,
      filename: track.filename,
      title: track.title,
      version: track.version,
      size: Number(track.size) || 0,
      contentType: track.contentType,
      uploadedAt: track.uploadedAt,
      downloadUrl: `/api/studio?action=internal-stream&id=${encodeURIComponent(track.id)}`,
    })),
  };
}

function planProjectDeletion(projects, tracks, requestedId) {
  const project = projects.find((item) => item.id === requestedId);
  if (!project) return null;
  const attachedTracks = tracks.filter((track) => track.projectId === requestedId);
  return {
    project,
    attachedTracks,
    remainingProjects: projects.filter((item) => item.id !== requestedId),
    remainingTracks: tracks.filter((track) => track.projectId !== requestedId),
  };
}

module.exports = { createProjectExport, planProjectDeletion, publicTrack };
