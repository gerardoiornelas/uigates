import * as crypto from 'crypto';
import { Receipt } from './types/primitives';

const digest = (r: Receipt) => crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');

function deepFreeze<T>(o: T): T {
  Object.freeze(o);
  for (const v of Object.values(o as object)) if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
  return o;
}

export class ReceiptStore {
  private receipts: Map<string, Receipt> = new Map();
  private digests: Map<string, string> = new Map();

  /**
   * Receipts are immutable: an id is written once. Re-recording identical
   * content is a harmless no-op; different content under the same id is an error.
   */
  record(receipt: Receipt): void {
    const existing = this.receipts.get(receipt.id);
    if (existing) {
      if (this.digests.get(receipt.id) === digest(receipt)) return;
      throw new Error(`Receipt ${receipt.id} already exists with different content; receipts are immutable.`);
    }

    // Validation: Gated actions MUST have evidence.
    if (receipt.evidence.length === 0) {
      console.warn(`[ReceiptStore] WARNING: Receipt ${receipt.id} submitted with NO evidence.`);
    }

    this.digests.set(receipt.id, digest(receipt));
    this.receipts.set(receipt.id, deepFreeze(structuredClone(receipt)));
    console.log(`[ReceiptStore] Recorded receipt ${receipt.id} for action ${receipt.actionPerformed}`);
  }

  get(id: string): Receipt | undefined {
    return this.receipts.get(id);
  }

  getByIntent(intentId: string): Receipt[] {
    return Array.from(this.receipts.values()).filter(r => r.intentId === intentId);
  }

  /** Receipts for one task under one intent, oldest first. */
  getByTask(intentId: string, taskId: string): Receipt[] {
    return this.getByIntent(intentId).filter(r => r.taskId === taskId);
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
    return receipt.evidence.some(e => e.trim().length > 0);
  }

  /** True when the stored receipt still matches what was recorded (e.g. no Date was mutated in place). */
  verifyIntegrity(id: string): boolean {
    const receipt = this.receipts.get(id);
    return !!receipt && digest(receipt) === this.digests.get(id);
  }
}
