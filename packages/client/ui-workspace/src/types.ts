/** Workspace navigation configuration shared by the Host and Client faces; types only. */
import type { Volatile } from '@deepseek-ai/cordis'

/** Live Workspace navigation preferences; the browser receives every field through its synced Config. */
export interface WorkspaceNavigationConfig {
  /** Open the most recent Workspace at startup. */
  autoOpenRecent: Volatile<boolean>
  /** Offer directory-backed Workspace creation. */
  allowDirectoryWorkspaceCreation: Volatile<boolean>
  /** Recently viewed Sessions needing no attention kept loaded besides the main-view Session. */
  recentViewLimit: Volatile<number>
}
