// GitHub OAuth (device flow) client ID.
//
// This is a PUBLIC identifier, not a secret — device-flow apps ship their
// client ID in the binary (the gh CLI and GitKraken do the same). The user
// still has to approve the sign-in on github.com, and the resulting token is
// stored encrypted via safeStorage on this machine only.
//
// VITE_GITHUB_CLIENT_ID in .env overrides the default for people who want to
// point the app at their own OAuth app.
export const DEFAULT_GITHUB_CLIENT_ID = 'Ov23limPa0dp9GndpcHp'

export const GITHUB_CLIENT_ID: string =
  import.meta.env.VITE_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID
