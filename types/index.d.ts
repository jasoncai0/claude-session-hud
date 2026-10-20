export type Usage = {
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

export type CheckStatus = 'pass' | 'fail' | 'pending'

export type Check = { label: string; status: CheckStatus }

export type MrView = {
  id: number
  url: string
  title: string
  repo: string
  source: string
  target: string
  state: string
  additions?: number
  deletions?: number
  checks: Check[]
  /** Where it lives; absent for Codeup. A GitHub PR is numbered `#n`, a Codeup MR `!n`. */
  forge?: 'github'
}

/** One Codeup repo the session works in: its checkout, branch and the branch's MRs. */
export type RepoView = {
  root: string
  repo: string
  branch: string
  mrs: MrView[]
  error?: string
  forge?: 'github'
  /** The rows are the last good fetch's, kept while this one failed. */
  isStale?: boolean
}

export type SessionView = { repos: RepoView[]; error?: string }

/** Created by the session (a lark-cli / MCP create call), or mentioned in a prompt, answer or tool call. */
export type DocOrigin = 'created' | 'mentioned'

export type DocLink = {
  /** The token in the URL path: the dedupe key. */
  token: string
  url: string
  /** The URL's path segment: docx, wiki, sheets, base, ... */
  kind: string
  /** The real title, from lark-cli. */
  title?: string
  /** A markdown link's text it was seen with: shown until the title is known, never in its place. */
  label?: string
  origin: DocOrigin
  /** Epoch ms it was last seen. */
  at: number
  /** True once a lookup gave a final answer (title, no access): never looked up again. */
  isLookedUp?: boolean
  /** Lookups that failed in a way worth retrying (timeouts, network); given up after a few. */
  lookupTries?: number
}

/** One job of a release-stage run, as the run page lists it. */
export type DeployJob = { name: string; status: string }

export type DeployStage = { name: string; status: string; jobs: DeployJob[] }

/** A release stage the session triggered on AppStack, and what its run looks like now. */
export type DeployRun = {
  /** `${app}/${stageSn}`: one entry per stage; triggering it again starts the entry over. */
  key: string
  app: string
  workflowSn: string
  stageSn: string
  /** The env deploy.sh was given (test / pre / prod), when known. */
  env?: string
  /** The release stage's name (生产, 预发…), when the trigger printed it. */
  stageName?: string
  branch?: string
  /** What the release ships (deploy.sh --feature). */
  feature?: string
  /** The run's page: the AppStack stage page, or the Flow run page when only that is known. */
  url: string
  /** The Flow pipeline run behind the release, when the trigger printed it: read directly, no execution matching. */
  flowPipelineId?: string
  flowRunId?: string
  /** Epoch ms of the trigger, or of when tracking started. */
  triggeredAt: number
  /** Tracked from a pasted stage link rather than triggered here: its latest execution is the run, however old. */
  isTracked?: boolean
  /** The stage execution this trigger started, once found. */
  number?: string
  /** The run's status as Yunxiao reports it: RUNNING, SUCCESS, FAIL, CANCELED, … */
  status?: string
  stages?: DeployStage[]
  /** The last refresh's failure, cleared by the next success. */
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-hud': {
      usage: Usage | null
      mrView: SessionView | null
      /** Directories the session's edits and git commands touched, newest last. */
      mrDirs: string[]
      /** `${repo}!${id}` of the MR whose checks are unfolded. */
      mrExpanded: string | null
      /** `${repo}!${id}` of MRs hidden from the band. */
      mrDismissed: string[]
      /** MRs the session opened (found by author and time) or linked, shown whatever branch is checked out. */
      mrPinned: { repoPath: string; localId: number; forge?: 'github' }[]
      /** Newest first. */
      docs: DocLink[]
      /** Tokens hidden from the band. */
      docsDismissed: string[]
      /** Newest first. */
      deploys: DeployRun[]
      /** `key` of the run whose stages are unfolded. */
      deployExpanded: string | null
      /** `key`s hidden from the band. */
      deployDismissed: string[]
      /** Lists (`mr`, `docs`, `deploy`) unfolded past their row cap. */
      expandedLists: string[]
      /** The band folded to one summary row; null until toggled (the `collapsed` option applies). */
      collapsed: boolean | null
    }
  }
}
