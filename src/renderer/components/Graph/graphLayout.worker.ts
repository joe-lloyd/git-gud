// Web Worker: computes the commit-graph layout off the main thread for large
// histories so the UI stays responsive. buildGraphLayout is pure (no DOM), so
// it runs unchanged here. Used by GraphView above GRAPH_WORKER_THRESHOLD.
import { buildGraphLayout } from './graphLayout'
import type { CommitNode } from '../../../preload/index'

type Req = { commits: CommitNode[]; stashShas: string[] }

self.onmessage = (e: MessageEvent<Req>) => {
  const { commits, stashShas } = e.data
  const nodes = buildGraphLayout(commits, new Set(stashShas))
  ;(self as unknown as Worker).postMessage(nodes)
}
