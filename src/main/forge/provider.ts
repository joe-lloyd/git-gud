// What a forge must provide for the PR review feature. Deliberately primitive
// (one call ≈ one REST request): composition — caching, "needs review", bot
// verdicts, diff slicing — lives in forge-host.ts, so a GitHub provider only
// has to map these calls.
import type { PullCommit, PullReviewSummary, StatusCheck } from "../peer-protocol";

export type ProviderPullRef = { repo: string; number: number; updatedAt: string };

export type ProviderPull = {
  repo: string;
  number: number;
  state: "open" | "closed";
  title: string;
  body: string;
  author: string;
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  headSha: string;
  base: string;
  head: string;
  add: number;
  del: number;
  files: number;
  comments: number;
  mergeable: boolean | null;
  url: string;
  requestedReviewers: string[];
};

export type ProviderComment = { user: string; body: string; url: string };

export interface ForgeProvider {
  readonly id: string;
  readonly kind: string;
  readonly url: string;
  /** Login of the token's user. */
  whoami(): Promise<string>;
  /** Open PRs visible to the token (optionally one owner/org). */
  searchOpenPulls(owner?: string): Promise<ProviderPullRef[]>;
  getPull(repo: string, number: number): Promise<ProviderPull>;
  /** Latest status per context for a commit. */
  getStatuses(repo: string, sha: string): Promise<StatusCheck[]>;
  /** Submitted (non-dismissed) reviews. */
  getReviews(repo: string, number: number): Promise<PullReviewSummary[]>;
  getComments(repo: string, number: number): Promise<ProviderComment[]>;
  /** Whole unified diff of the PR at its current head. */
  getDiff(repo: string, number: number): Promise<string>;
  getCommits(repo: string, number: number): Promise<PullCommit[]>;
}

export class ForgeRequestError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "ForgeRequestError";
  }
}
