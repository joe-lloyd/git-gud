import { Octokit } from '@octokit/rest'
import { safeStorage } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface GitHubUser {
  login: string
  avatar_url: string
  name: string | null
}

export interface GitHubRepo {
  name: string
  full_name: string
  html_url: string
  ssh_url: string
  clone_url: string
}

export class GitHubService {
  private octokit: Octokit | null = null
  private configPath: string

  constructor() {
    this.configPath = join(app.getPath('userData'), 'github-config.json')
    this.loadToken()
  }

  private loadToken() {
    try {
      if (fs.existsSync(this.configPath)) {
        const encryptedToken = fs.readFileSync(this.configPath)
        if (safeStorage.isEncryptionAvailable()) {
          const token = safeStorage.decryptString(encryptedToken)
          this.octokit = new Octokit({ auth: token })
        }
      }
    } catch (e) {
      console.error('Failed to load GitHub token', e)
    }
  }

  private saveToken(token: string) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(token)
        fs.writeFileSync(this.configPath, encrypted)
      } else {
        // Fallback for environments where safeStorage is disabled
        fs.writeFileSync(this.configPath, Buffer.from(token, 'utf-8'))
      }
    } catch (e) {
      console.error('Failed to save GitHub token', e)
      throw new Error('Failed to save securely.')
    }
  }

  public clearToken() {
    this.octokit = null
    try {
      if (fs.existsSync(this.configPath)) {
        fs.unlinkSync(this.configPath)
      }
    } catch (e) {
      console.error('Failed to clear GitHub token', e)
    }
  }

  public getToken(): string | null {
    try {
      if (fs.existsSync(this.configPath)) {
        const encryptedToken = fs.readFileSync(this.configPath)
        if (safeStorage.isEncryptionAvailable()) {
          return safeStorage.decryptString(encryptedToken)
        } else {
          return encryptedToken.toString('utf-8')
        }
      }
    } catch (e) {
      console.error('Failed to read GitHub token', e)
    }
    return null
  }

  public async startDeviceFlow(clientId: string): Promise<{ device_code: string; user_code: string; verification_uri: string; interval: number }> {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'repo'
      })
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`)
    }

    const data = (await response.json()) as any
    if (data.error) {
      throw new Error(data.error_description || data.error)
    }

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      interval: data.interval
    }
  }

  public async pollForToken(clientId: string, deviceCode: string): Promise<GitHubUser> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.statusText}`)
    }

    const data = (await response.json()) as any
    if (data.error) {
      throw new Error(data.error) // authorization_pending, slow_down, expired_token, access_denied
    }

    const token = data.access_token
    const tempOctokit = new Octokit({ auth: token })
    try {
      const { data: user } = await tempOctokit.rest.users.getAuthenticated()
      this.octokit = tempOctokit
      this.saveToken(token)
      return {
        login: user.login,
        avatar_url: user.avatar_url,
        name: user.name,
      }
    } catch (e) {
      throw new Error('Failed to fetch user data with new token')
    }
  }

  public async getAuthenticatedUser(): Promise<GitHubUser | null> {
    if (!this.octokit) return null
    try {
      const { data } = await this.octokit.rest.users.getAuthenticated()
      return {
        login: data.login,
        avatar_url: data.avatar_url,
        name: data.name,
      }
    } catch {
      this.clearToken()
      return null
    }
  }

  public async createRepository(name: string, description: string, isPrivate: boolean): Promise<GitHubRepo> {
    if (!this.octokit) throw new Error('Not authenticated')
    try {
      const { data } = await this.octokit.rest.repos.createForAuthenticatedUser({
        name,
        description,
        private: isPrivate,
        auto_init: false, // We usually want an empty repo to push existing local code
      })
      return {
        name: data.name,
        full_name: data.full_name,
        html_url: data.html_url,
        ssh_url: data.ssh_url,
        clone_url: data.clone_url,
      }
    } catch (e: any) {
      throw new Error(e.message || 'Failed to create repository')
    }
  }

  public async listRepositories(): Promise<GitHubRepo[]> {
    if (!this.octokit) throw new Error('Not authenticated')
    try {
      // Get up to 100 recent repositories
      const { data } = await this.octokit.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100
      })
      return data.map((repo: any) => ({
        name: repo.name,
        full_name: repo.full_name,
        html_url: repo.html_url,
        ssh_url: repo.ssh_url,
        clone_url: repo.clone_url,
      }))
    } catch (e: any) {
      throw new Error(e.message || 'Failed to list repositories')
    }
  }
}
