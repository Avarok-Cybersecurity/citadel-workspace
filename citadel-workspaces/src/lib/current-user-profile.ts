/**
 * What the signed-in user's own member record says about their profile.
 *
 * Their own record reaches them unredacted (the server redacts OTHER members'
 * records), so it is the source for the avatar, email and title the app shows
 * them and that Settings starts from. Email and title are taken as they are --
 * an absent key means cleared. The avatar keeps the previous one when absent,
 * which is what the members path already did.
 */
import { avatarUrlFromMetadata } from './avatar-url';
import { profileFieldsFromMetadata } from './profile-metadata';
import { showsProfileToStrangers } from './profile-privacy';

export interface CurrentUserProfile {
  avatarUrl?: string;
  email?: string;
  title?: string;
  showProfileToStrangers: boolean;
}

export function currentUserProfileFromMetadata(metadata: unknown, previousAvatarUrl: string | undefined): CurrentUserProfile {
  return {
    avatarUrl: avatarUrlFromMetadata(metadata) ?? previousAvatarUrl,
    ...profileFieldsFromMetadata(metadata),
    showProfileToStrangers: showsProfileToStrangers(metadata),
  };
}
