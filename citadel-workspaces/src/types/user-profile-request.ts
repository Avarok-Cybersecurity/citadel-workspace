/** `WorkspaceProtocolRequestTS.UpdateUserProfile`: every field optional, absent leaves it alone. */
export interface UpdateUserProfileRequest {
  name?: string;
  avatar_data?: string; // avatar: base64-encoded WebP image
  email?: string; // '' clears it
  title?: string; // '' clears it
  // See lib/profile-privacy.ts.
  show_profile_to_strangers?: boolean;
  accepts_requests_from_strangers?: boolean;
  shows_online_status?: boolean;
}
