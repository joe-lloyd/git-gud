export type RootStack = {
  Machines: undefined
  Pair: undefined
  Repos: { peerId: string }
  Repo: { peerId: string; repoPath: string; name: string }
  Commit: { peerId: string; repoPath: string; sha: string; subject: string }
  Diff: { peerId: string; repoPath: string; path: string; staged?: boolean; sha?: string }
}
