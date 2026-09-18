import { Receipt } from './types/primitives';

export class ReceiptStore {
  private receipts: Map<string, Receipt> = new Map();

  record(receipt: Receipt): void {
    // Validation: Gated actions MUST have evidence.
    if (receipt.evidence.length === 0) {
      console.warn(`[ReceiptStore] WARNING: Receipt ${receipt.id} submitted with NO evidence.`);
    }

    this.receipts.set(receipt.id, receipt);
    console.log(`[ReceiptStore] Recorded receipt ${receipt.id} for action ${receipt.actionPerformed}`);
  }

  get(id: string): Receipt | undefined {
    return this.receipts.get(id);
  }

  getByIntent(intentId: string): Receipt[] {
    return Array.from(this.receipts.values()).filter(r => r.intentId === intentId);
  }

  getByActor(actorId: string): Receipt[] {
    return Array.from(this.receipts.values()).filter(r => r.actorId === actorId);
  }

  /**
   * Verifies that a receipt is honest (has evidence).
   */
  verifyHonesty(id: string): boolean {
    const receipt = this.get(id);
    if (!receipt) return false;
    return receipt.evidence.length > 0;
  }
}
