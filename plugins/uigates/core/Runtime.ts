import { StateStore } from './StateStore';
import { GovernanceEngine } from './GovernanceEngine';
import { ReceiptStore } from './ReceiptStore';

/**
 * The engine's authority ledger, receipt store and cumulative-risk counters live in memory,
 * but an agent reaches UI-GATES through a CLI that starts a fresh process per call. Runtime
 * rebuilds that state from the write-once records in the state directory (`.uigates/`, or `.uig/` in an older project), so a rule such as "an
 * authorization is spent once" or "no retry on a delta without a replan" holds across calls.
 *
 * Integrity note: the records are plain files the agent's own process can also write. This makes
 * them tamper-evident to the engine's checks (write-once, hash-bound evidence, issued-authority
 * tracing), not tamper-proof against a hostile agent. Real enforcement needs records signed with
 * a key the agent cannot read; that is not built.
 */
export class Runtime {
  readonly state: StateStore;
  readonly receipts = new ReceiptStore(true);
  readonly gov: GovernanceEngine;
  /** Records that could not be traced to a complete authority chain. They authorize nothing. */
  readonly orphans: string[] = [];

  constructor(readonly root: string) {
    this.state = new StateStore(root);
    this.gov = new GovernanceEngine([], undefined, this.receipts);

    for (const authorization of this.state.listAuthorizations()) {
      const proposal = this.state.getProposal(authorization.proposalId);
      const intent = this.state.getIntent(authorization.intentId);
      if (!proposal || !intent) { this.orphans.push(authorization.id); continue; }
      this.gov.ledger.register({ authorization, proposal, intent });
      this.gov.recordAuthorizedRisk(intent.id, proposal.impact);
    }
    for (const receipt of this.state.listReceipts()) this.receipts.record(receipt);
  }
}
