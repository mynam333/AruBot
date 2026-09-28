export function isPvdDocumentHidden() {
  // OBS renders off-screen and can report document.hidden while its source is running.
  const obs = (window as Window & { obsstudio?: unknown }).obsstudio;
  return !obs && document.hidden;
}
