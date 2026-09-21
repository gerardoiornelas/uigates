/**
 * UI-GATES Core Primitives
 *
 * This file defines the foundational types for the governance layer.
 * The goal is to decouple Capability (what an agent can do) from
 * Authority (what an agent is allowed to do).
 */

export type AuthorityState = 'observe' | 'delegated' | 'gated' | 'prohibited';

export interface Principal {
  id: string;
  name: string;
  role: string;
}

export interface Intent {
  id: string;
  principalId: string;
  goal: string;
  constraints: string[];
  successEvidence: string[];
  authorityDomain: string[]; // Resources/Scopes the intent covers
  /** When set, only these actors may act under the intent. Omitted = any actor the principal lets propose. */
  authorizedActors?: string[];
  expiry: Date;
  createdAt: Date;
}

export interface Proposal {
  id: string;
  intentId: string;
  actorId: string;
  action: string;
  resource: string;
  rationale: string;
  impact: 'low' | 'medium' | 'high';
  risk: string;
  authorityRequested: AuthorityState;
  verificationPlan: string;
  proposedAt: Date;
  /**
   * Names the unit of work this proposal advances, so the engine can tell a retry from new work.
   * Without it a proposal is never treated as a retry.
   */
  taskId?: string;
  /**
   * Required when the task's latest receipt ended in a delta: "do not retry on a delta without
   * first returning to planning to address its root cause" (skills/uigates). The engine checks that
   * the replan exists and cites the failing receipt; it cannot judge whether the replan is sound.
   */
  replan?: { after: string; rootCause: string; revision: string };
}

/**
 * Authority is time-, actor-, action-, resource- and intent-bounded (architecture.md),
 * so the authorization carries each of those bounds itself.
 */
export interface Authorization {
  id: string;
  proposalId: string;
  authorizedBy: string; // Principal ID
  state: AuthorityState;
  authorizedAt: Date;
  expiry?: Date;
  actorId: string;
  intentId: string;
  action: string;
  resource: string;
}

export interface Receipt {
  id: string;
  authorizationId: string;
  intentId: string;
  actorId: string;
  actionPerformed: string;
  expectedOutcome: string;
  actualOutcome: string;
  delta: string;
  evidence: string[]; // Links to logs, test results, commit hashes
  verifiedAt: Date;
  taskId?: string; // the Proposal.taskId this execution advanced
  /**
   * What the next agent should know, stated by the agent when it records the receipt. A receipt
   * proves the action worked; it says nothing about what the action teaches. Without this the
   * synthesizer can only restate the action, which is how a ledger fills with process.
   * The claim is the agent's own and is not verified.
   */
  lesson?: string;
}

export interface Policy {
  id: string;
  name: string;
  rule: (proposal: Proposal, intent: Intent) => boolean;
  description: string;
}

export interface Knowledge {
  id: string;
  receiptId: string;
  lesson: string;
  provenance: string;
  verifiedAt: Date;
  status: 'candidate' | 'verified' | 'deprecated';
}
