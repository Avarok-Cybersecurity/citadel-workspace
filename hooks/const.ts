export const API_URL =
  process.env.NEXT_PUBLIC_FRAMEWORK === 'citadel_local'
    ? process.env.CITADEL_PUBLIC_LOCAL_DOMAIN
    : process.env.CITADEL_PUBLIC_DOMAIN;
