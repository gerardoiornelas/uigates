import { StateStore } from '../../core/StateStore';
import { GovernanceEngine } from '../../core/GovernanceEngine';
import { ReceiptStore } from '../../core/ReceiptStore';
import { UIGatesWrapper, IntelligenceEngine } from '../../core/UIGatesWrapper';
import { Proposal } from '../../core/types/primitives';

/** Runs an explicitly supplied worker. There is no random-success fallback. */
export class LoopDriver {
  constructor(
    private store: StateStore,
    private govEngine: GovernanceEngine,
    private receiptStore: ReceiptStore,
    private worker: IntelligenceEngine,
    private approveGated?: (proposal: Proposal, principalId: string) => Promise<boolean>,
  ) {
    if (!worker) throw new Error('LoopDriver requires a real worker; mock success is not execution evidence.');
  }

  async run(intentId: string): Promise<void> {
    const intent = this.store.getIntent(intentId);
    if (!intent) throw new Error('Intent not found');
    const wrapper = new UIGatesWrapper(this.worker, this.govEngine, this.receiptStore, this.approveGated);
    await wrapper.runTask(intent, intent.principalId);
  }
}
