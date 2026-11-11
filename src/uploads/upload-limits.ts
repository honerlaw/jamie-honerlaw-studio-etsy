// Limits for photo uploads (proposal: Tools → Photos).
export const UPLOAD_LIMITS = {
  // One upload link lives 30 minutes.
  sessionTtlMs: 30 * 60 * 1000,
  // attach_uploaded_photos holds the session this long at most.
  attachLeaseMs: 120 * 1000,
  maxImages: 10,
  maxBytes: 10 * 1024 * 1024,
  maxSidePx: 6000,
} as const;

// Where a listing's upload session lives in the OneTimeStore.
export function uploadSessionKey(listingId: number): string {
  return `upload-session:${String(listingId)}`;
}
