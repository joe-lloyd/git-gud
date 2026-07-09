import { safeStorage, app } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

// GitLab + Bitbucket integration. GitHub keeps its own service (device-flow
// OAuth); these two sign in with tokens instead — GitLab/Bitbucket OAuth for a
// desktop app requires registering per-vendor apps (and Bitbucket's flow needs
// a client secret, which can't ship in a binary), so PAT / app-password is the
// standard desktop-client approach.

export type HostedProvider = 'gitlab' | 'bitbucket'

export type ProviderUser = {
  login: string
  avatar_url: string
  name: string | null
}

export type ProviderRepo = {
  name: string
  full_name: string
  html_url: string
  ssh_url: string
  clone_url: string
}

type StoredAuth = {
  gitlab?: { host: string; token: string }
  bitbucket?: { username: string; token: string }
}

const DEFAULT_GITLAB_HOST = 'https://gitlab.com'
const BITBUCKET_API = 'https://api.bitbucket.org/2.0'

// Strip trailing slashes so `${host}/api/v4/...` never doubles them.
const normalizeHost = (host: string) =>
  (host.trim() || DEFAULT_GITLAB_HOST).replace(/\/+$/, '')

export class ProviderService {
  private configPath: string
  private auth: StoredAuth = {}
  // Bitbucket repo creation needs a workspace; the user's own username works
  // as the personal workspace. Cached from the sign-in validation call.
  private bitbucketWorkspace: string | null = null

  constructor() {
    this.configPath = join(app.getPath('userData'), 'provider-auth.json')
    this.load()
  }

  private load() {
    try {
      if (!fs.existsSync(this.configPath)) return
      const raw = fs.readFileSync(this.configPath)
      const json = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(raw)
        : raw.toString('utf-8')
      this.auth = JSON.parse(json)
    } catch (e) {
      console.error('Failed to load provider auth', e)
      this.auth = {}
    }
  }

  private save() {
    try {
      const json = JSON.stringify(this.auth)
      const data = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(json)
        : Buffer.from(json, 'utf-8')
      fs.writeFileSync(this.configPath, data)
    } catch (e) {
      console.error('Failed to save provider auth', e)
      throw new Error('Failed to save credentials securely.')
    }
  }

  signOut(provider: HostedProvider) {
    delete this.auth[provider]
    if (provider === 'bitbucket') this.bitbucketWorkspace = null
    this.save()
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  private async gitlabFetch(path: string, init: RequestInit = {}, override?: { host: string; token: string }) {
    const cfg = override ?? this.auth.gitlab
    if (!cfg) throw new Error('Not signed in to GitLab')
    const res = await fetch(`${cfg.host}/api/v4${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`GitLab API ${res.status}: ${extractApiError(body) || res.statusText}`)
    }
    return res.json() as Promise<any>
  }

  private async bitbucketFetch(path: string, init: RequestInit = {}, override?: { username: string; token: string }) {
    const cfg = override ?? this.auth.bitbucket
    if (!cfg) throw new Error('Not signed in to Bitbucket')
    const basic = Buffer.from(`${cfg.username}:${cfg.token}`).toString('base64')
    const res = await fetch(`${BITBUCKET_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Bitbucket API ${res.status}: ${extractApiError(body) || res.statusText}`)
    }
    return res.json() as Promise<any>
  }

  // ── Sign-in (validates the token before storing it) ─────────────────────

  async signInGitLab(host: string, token: string): Promise<ProviderUser> {
    const cfg = { host: normalizeHost(host), token: token.trim() }
    const u = await this.gitlabFetch('/user', {}, cfg)
    this.auth.gitlab = cfg
    this.save()
    return { login: u.username, avatar_url: u.avatar_url ?? '', name: u.name ?? null }
  }

  async signInBitbucket(username: string, token: string): Promise<ProviderUser> {
    const cfg = { username: username.trim(), token: token.trim() }
    const u = await this.bitbucketFetch('/user', {}, cfg)
    this.auth.bitbucket = cfg
    this.bitbucketWorkspace = u.username ?? cfg.username
    this.save()
    return {
      login: u.username ?? cfg.username,
      avatar_url: u.links?.avatar?.href ?? '',
      name: u.display_name ?? null,
    }
  }

  // ── Session / user info ──────────────────────────────────────────────────

  async getUser(provider: HostedProvider): Promise<ProviderUser | null> {
    try {
      if (provider === 'gitlab') {
        if (!this.auth.gitlab) return null
        const u = await this.gitlabFetch('/user')
        return { login: u.username, avatar_url: u.avatar_url ?? '', name: u.name ?? null }
      }
      if (!this.auth.bitbucket) return null
      const u = await this.bitbucketFetch('/user')
      this.bitbucketWorkspace = u.username ?? this.auth.bitbucket.username
      return {
        login: u.username ?? this.auth.bitbucket.username,
        avatar_url: u.links?.avatar?.href ?? '',
        name: u.display_name ?? null,
      }
    } catch {
      // Token revoked / host unreachable — treat as signed out but keep the
      // stored credentials so a transient network error isn't a forced logout.
      return null
    }
  }

  // ── Repositories ─────────────────────────────────────────────────────────

  async createRepo(
    provider: HostedProvider,
    name: string,
    description: string,
    isPrivate: boolean,
  ): Promise<ProviderRepo> {
    if (provider === 'gitlab') {
      const p = await this.gitlabFetch('/projects', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: description || undefined,
          visibility: isPrivate ? 'private' : 'public',
          initialize_with_readme: false,
        }),
      })
      return {
        name: p.name,
        full_name: p.path_with_namespace,
        html_url: p.web_url,
        ssh_url: p.ssh_url_to_repo,
        clone_url: p.http_url_to_repo,
      }
    }

    const workspace = this.bitbucketWorkspace ?? this.auth.bitbucket?.username
    if (!workspace) throw new Error('Not signed in to Bitbucket')
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug) throw new Error('Repository name must contain letters or digits')
    const r = await this.bitbucketFetch(`/repositories/${workspace}/${slug}`, {
      method: 'PUT', // Bitbucket creates on PUT to the repo slug
      body: JSON.stringify({ scm: 'git', is_private: isPrivate, description: description || undefined }),
    })
    return bitbucketRepo(r)
  }

  async listRepos(provider: HostedProvider): Promise<ProviderRepo[]> {
    if (provider === 'gitlab') {
      const list = await this.gitlabFetch(
        '/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=100&simple=false',
      )
      return (list as any[]).map((p) => ({
        name: p.name,
        full_name: p.path_with_namespace,
        html_url: p.web_url,
        ssh_url: p.ssh_url_to_repo,
        clone_url: p.http_url_to_repo,
      }))
    }
    const page = await this.bitbucketFetch('/repositories?role=member&sort=-updated_on&pagelen=50')
    return ((page.values ?? []) as any[]).map(bitbucketRepo)
  }

  // ── Git auth injection ───────────────────────────────────────────────────
  // `-c http.<host>.extraheader=…` pairs for every signed-in provider, so
  // fetch/pull/push against those hosts authenticate without a credential
  // helper. GitLab accepts `oauth2:<PAT>` as basic auth; Bitbucket wants
  // `username:app-password`.

  getGitAuthConfigs(): string[] {
    const configs: string[] = []
    if (this.auth.gitlab) {
      const b64 = Buffer.from(`oauth2:${this.auth.gitlab.token}`).toString('base64')
      configs.push('-c', `http.${this.auth.gitlab.host}/.extraheader=AUTHORIZATION: basic ${b64}`)
    }
    if (this.auth.bitbucket) {
      const b64 = Buffer.from(`${this.auth.bitbucket.username}:${this.auth.bitbucket.token}`).toString('base64')
      configs.push('-c', `http.https://bitbucket.org/.extraheader=AUTHORIZATION: basic ${b64}`)
    }
    return configs
  }
}

// Normalize a Bitbucket API repository object.
function bitbucketRepo(r: any): ProviderRepo {
  const clones: Array<{ name: string; href: string }> = r.links?.clone ?? []
  const https = clones.find((c) => c.name === 'https')?.href ?? ''
  const ssh = clones.find((c) => c.name === 'ssh')?.href ?? ''
  return {
    name: r.name,
    full_name: r.full_name,
    html_url: r.links?.html?.href ?? '',
    // Bitbucket embeds `user@` in the https clone URL; strip it so the URL is
    // account-neutral (auth comes from the injected header instead).
    clone_url: https.replace(/^https:\/\/[^@/]+@/, 'https://'),
    ssh_url: ssh,
  }
}

// GitLab errors come as {"message": …} or {"error_description": …}; Bitbucket
// as {"error": {"message": …}}. Fall back to raw text, trimmed.
function extractApiError(body: string): string {
  try {
    const j = JSON.parse(body)
    const msg = j?.error?.message ?? j?.error_description ?? j?.message ?? j?.error
    if (typeof msg === 'string') return msg
    if (msg && typeof msg === 'object') return JSON.stringify(msg)
  } catch { /* not JSON */ }
  return body.slice(0, 200)
}
