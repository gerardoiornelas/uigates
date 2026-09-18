import * as fs from 'fs';
import * as path from 'path';
import { Intent, Proposal, Authorization, Receipt } from './types/primitives';

/** Authority and audit records are write-once: rewriting one would rewrite history. */
function writeOnce(filePath: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2);
  if (fs.existsSync(filePath)) {
    if (fs.readFileSync(filePath, 'utf8') === text) return;
    throw new Error(`${path.basename(filePath)} already exists with different content; UI-GATES records are write-once.`);
  }
  fs.writeFileSync(filePath, text, { flag: 'wx' });
}

export class StateStore {
  private baseDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.baseDir = path.join(projectRoot, '.uig');
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = ['intents', 'proposals', 'authorizations', 'receipts', 'knowledge'];
    dirs.forEach(dir => {
      const fullPath = path.join(this.baseDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    });
  }

  // --- Intent Methods ---

  saveIntent(intent: Intent): void {
    const filePath = path.join(this.baseDir, 'intents', `${intent.id}.json`);
    writeOnce(filePath, intent);
  }

  getIntent(id: string): Intent | null {
    const filePath = path.join(this.baseDir, 'intents', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // --- Proposal Methods ---

  saveProposal(proposal: Proposal): void {
    const filePath = path.join(this.baseDir, 'proposals', `${proposal.id}.json`);
    writeOnce(filePath, proposal);
  }

  getProposal(id: string): Proposal | null {
    const filePath = path.join(this.baseDir, 'proposals', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  listProposals(): Proposal[] {
    const dir = path.join(this.baseDir, 'proposals');
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  }

  // --- Authorization Methods ---

  saveAuthorization(auth: Authorization): void {
    const filePath = path.join(this.baseDir, 'authorizations', `${auth.id}.json`);
    writeOnce(filePath, auth);
  }

  getAuthorization(id: string): Authorization | null {
    const filePath = path.join(this.baseDir, 'authorizations', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // --- Receipt Methods ---

  saveReceipt(receipt: Receipt): void {
    const filePath = path.join(this.baseDir, 'receipts', `${receipt.id}.json`);
    writeOnce(filePath, receipt);
  }

  getReceipt(id: string): Receipt | null {
    const filePath = path.join(this.baseDir, 'receipts', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  listReceiptsByIntent(intentId: string): Receipt[] {
    const dir = path.join(this.baseDir, 'receipts');
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.json'))
      .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
      .filter(r => r.intentId === intentId);
  }
}
