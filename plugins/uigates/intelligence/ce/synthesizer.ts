import * as fs from 'fs';
import * as path from 'path';
import { ReceiptStore } from '../../core/ReceiptStore';
import { Receipt } from '../../core/types/primitives';

export class CESynthesizer {
  private store: ReceiptStore;
  private knowledgeDir: string;

  constructor(store: ReceiptStore, projectRoot: string = process.cwd()) {
    this.store = store;
    this.knowledgeDir = path.join(projectRoot, '.uig', 'knowledge', 'compound_packs');
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.knowledgeDir)) {
      fs.mkdirSync(this.knowledgeDir, { recursive: true });
    }
  }

  /**
   * Scans receipts and synthesizes "Compound Packs" for successful patterns.
   */
  async synthesize(intentId: string): Promise<void> {
    const receipts = this.store.getByIntent(intentId);
    console.log(`[CE] Synthesizing knowledge from ${receipts.length} receipts...`);

    for (const receipt of receipts) {
      if (receipt.delta === 'None' && receipt.actualOutcome.includes('success')) {
        this.promoteToKnowledge(receipt);
      }
    }
  }

  private promoteToKnowledge(receipt: Receipt): void {
    const packName = `lesson_${receipt.actionPerformed.toLowerCase().replace(/\s+/g, '_')}.md`;
    const filePath = path.join(this.knowledgeDir, packName);

    const content = `
# Knowledge Pack: ${receipt.actionPerformed}
**Proven Pattern**

## Context
- Intent: ${receipt.intentId}
- Actor: ${receipt.actorId}

## Verified Action
${receipt.actionPerformed}

## Evidence of Success
${receipt.evidence.join(', ')}

## Why it worked
The action resulted in a zero-delta outcome. This pattern is now recommended for similar tasks.
    `.trim();

    fs.writeFileSync(filePath, content);
    console.log(`[CE] Promoted successful pattern to: ${packName}`);
  }
}
