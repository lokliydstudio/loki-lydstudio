const { commentsForTrack } = require("./crm-audio-comments");
const { publicAudioPlaylist } = require("./crm-audio-playlists");
const { publicProjectImage } = require("./crm-project-images");

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

function createProjectExport(projects, tracks, requestedId = "", comments = [], projectImages = [], audioPlaylists = []) {
  const selectedProjects = requestedId
    ? projects.filter((project) => project.id === requestedId)
    : projects;
  if (requestedId && selectedProjects.length === 0) return null;

  const projectIds = new Set(selectedProjects.map((project) => project.id));
  const selectedTracks = tracks.filter((track) => projectIds.has(track.projectId));
  const selectedImages = projectImages.filter((image) => projectIds.has(image.projectId));
  const selectedPlaylists = audioPlaylists.filter((playlist) => projectIds.has(playlist.projectId));

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
      technicalImages: selectedImages
        .filter((image) => image.projectId === project.id)
        .map(publicProjectImage),
      deliveryPlaylists: selectedPlaylists
        .filter((playlist) => playlist.projectId === project.id)
        .map(publicAudioPlaylist),
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
    imageFiles: selectedImages.map((image) => ({
      ...publicProjectImage(image),
      downloadUrl: `/api/studio?action=project-image-stream&id=${encodeURIComponent(image.id)}&download=1`,
    })),
  };
}

function planProjectDeletion(projects, tracks, requestedId, projectImages = []) {
  const project = projects.find((item) => item.id === requestedId);
  if (!project) return null;
  const attachedTracks = tracks.filter((track) => track.projectId === requestedId);
  const attachedImages = projectImages.filter((image) => image.projectId === requestedId);
  return {
    project,
    attachedTracks,
    attachedImages,
    remainingProjects: projects.filter((item) => item.id !== requestedId),
    remainingTracks: tracks.filter((track) => track.projectId !== requestedId),
    remainingImages: projectImages.filter((image) => image.projectId !== requestedId),
  };
}

module.exports = { createProjectExport, planProjectDeletion, publicTrack };
