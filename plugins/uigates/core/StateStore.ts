import * as fs from 'fs';
import * as path from 'path';
import { Intent, Proposal, Authorization, Receipt } from './types/primitives';

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
    fs.writeFileSync(filePath, JSON.stringify(intent, null, 2));
  }

  getIntent(id: string): Intent | null {
    const filePath = path.join(this.baseDir, 'intents', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // --- Proposal Methods ---

  saveProposal(proposal: Proposal): void {
    const filePath = path.join(this.baseDir, 'proposals', `${proposal.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));
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
    fs.writeFileSync(filePath, JSON.stringify(auth, null, 2));
  }

  getAuthorization(id: string): Authorization | null {
    const filePath = path.join(this.baseDir, 'authorizations', `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // --- Receipt Methods ---

  saveReceipt(receipt: Receipt): void {
    const filePath = path.join(this.baseDir, 'receipts', `${receipt.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2));
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
