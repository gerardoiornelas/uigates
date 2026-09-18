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
}

export interface Authorization {
  id: string;
  proposalId: string;
  authorizedBy: string; // Principal ID
  state: AuthorityState;
  authorizedAt: Date;
  expiry?: Date;
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
