import { Authorization, Intent, Proposal, Receipt } from './types/primitives';

export interface IssuedAuthority {
  authorization: Authorization;
  proposal: Proposal;
  intent: Intent;
}

export interface ReceiptVerdict {
  ok: boolean;
  reason: string;
}

/**
 * The record of every authority the GovernanceEngine has actually issued.
 *
 * A receipt is "an immutable record of an authorized execution" (architecture.md),
 * so a receipt only counts as one if it can be traced to an authorization issued
 * here, for this actor, this action, this intent, inside its time window, and not
 * already spent on another receipt.
 *
 * Integrity note: the ledger is in-memory and trusts the process that holds it.
 * Persisting it across processes needs signed records, which is not built.
 */
export class AuthorityLedger {
  private issued = new Map<string, IssuedAuthority>();
  private spentBy = new Map<string, string>(); // authorization id -> receipt id

  register(entry: IssuedAuthority): void {
    if (this.issued.has(entry.authorization.id)) {
      throw new Error(`Authorization ${entry.authorization.id} already exists; authority records are write-once.`);
    }
    this.issued.set(entry.authorization.id, structuredClone(entry));
  }

  lookup(authorizationId: string): IssuedAuthority | undefined {
    const e = this.issued.get(authorizationId);
    return e ? structuredClone(e) : undefined;
  }

  /**
   * Decide whether a receipt is backed by real authority. Admitting a receipt
   * spends its authorization, so one authorization cannot launder many receipts.
   * Re-admitting the same receipt is idempotent.
   */
  admitReceipt(r: Receipt): ReceiptVerdict {
    const held = this.issued.get(r.authorizationId);
    if (!held) return no(`authorization "${r.authorizationId}" was never issued`);
    const { authorization: a, intent } = held;

    if (a.state !== 'delegated' && a.state !== 'gated') return no(`authorization state "${a.state}" permits no execution`);
    // Signed by the intent's principal, or by the docs/compound-engineering/graph-jev-aar.md advisory
    // path ("jev:<backend>", never a caller-supplied string — see GovernanceEngine.authorizeViaAdvisory).
    // Neither is cryptographically provable from a plain file; both are exactly the trust level mvp.md
    // already documents ("tamper-evident to the engine's checks, not tamper-proof against a hostile agent").
    if (a.authorizedBy !== intent.principalId && !a.authorizedBy.startsWith('jev:')) {
      return no(`authorization was not signed by the intent's principal`);
    }
    if (a.actorId !== r.actorId) return no(`authorization was issued to "${a.actorId}", not "${r.actorId}"`);
    if (a.intentId !== r.intentId) return no(`authorization belongs to intent "${a.intentId}", not "${r.intentId}"`);
    if (a.action !== r.actionPerformed) return no(`authorization covers "${a.action}", not "${r.actionPerformed}"`);

    const at = new Date(r.verifiedAt).getTime();
    if (![at, new Date(a.authorizedAt).getTime(), ...(a.expiry ? [new Date(a.expiry).getTime()] : [])].every(Number.isFinite)) return no('invalid authority or receipt timestamp');
    if (at < new Date(a.authorizedAt).getTime()) return no('receipt predates its authorization');
    if (a.expiry && at > new Date(a.expiry).getTime()) return no('receipt was produced after the authorization expired');

    const prior = this.spentBy.get(a.id);
    if (prior && prior !== r.id) return no(`authorization already spent on receipt "${prior}"`);
    this.spentBy.set(a.id, r.id);
    return { ok: true, reason: 'authorized' };
  }
}

function no(reason: string): ReceiptVerdict {
  return { ok: false, reason };
}
