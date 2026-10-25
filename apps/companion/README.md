# Companion app

## Browser preview

Run `pnpm --filter @gitgud/companion web`. Browser pairings and bearer tokens stay in memory for the current page. Reloading or closing the page clears them, so pair again after a reload. Tokens are never written to localStorage or sessionStorage. Native apps keep pairings in SecureStore.
