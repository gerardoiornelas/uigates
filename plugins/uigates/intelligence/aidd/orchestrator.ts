import { Intent, Proposal } from '../../core/types/primitives';
import { StateStore } from '../../core/StateStore';

export interface Task {
  id: string;
  description: string;
  verificationPlan: string;
  status: 'pending' | 'in_progress' | 'completed';
  authorityRequired: 'delegated' | 'gated';
}

export class AIDDOrchestrator {
  private store: StateStore;

  constructor(store: StateStore) {
    this.store = store;
  }

  /**
   * Decomposes an Intent into a set of verifiable tasks.
   * This implements the "80/20" rule: spend 80% of the effort on the plan.
   */
  async generatePlan(intent: Intent): Promise<Task[]> {
    console.log(`[AIDD] Decomposing intent: ${intent.goal}...`);

    // In a real system, this would call an LLM to decompose the goal.
    // We simulate a high-quality decomposition here.
    const tasks: Task[] = [
      {
        id: 'task-1',
        description: 'Analyze current auth implementation and identify bottlenecks',
        verificationPlan: ' produce a bottleneck report.md',
        status: 'pending',
        authorityRequired: 'delegated',
      },
      {
        id: 'task-2',
        description: 'Refactor session validation logic to reduce DB queries',
        verificationPlan: 'Compare DB query count before/after using logs',
        status: 'pending',
        authorityRequired: 'delegated',
      },
      {
        id: 'task-3',
        description: 'Update production API keys and environment config',
        verificationPlan: 'Verify API connectivity in staging environment',
        status: 'pending',
        authorityRequired: 'gated',
      },
    ];

    return tasks;
  }

  /**
   * Writes the generated tasks to the project's FIX_PLAN.md.
   */
  async writeFixPlan(tasks: Task[]): Promise<void> {
    let content = '# FIX_PLAN.md\n\n';
    content += '## Tasks\n\n';

    tasks.forEach(t => {
      content += `- [ ] **${t.id}**: ${t.description}\n`;
      content += `  - **Verification**: ${t.verificationPlan}\n`;
      content += `  - **Authority**: ${t.authorityRequired}\n\n`;
    });

    // Write to the root of the current working directory as per Ralph Loop pattern
    import('fs').then(fs => {
      fs.writeFileSync('FIX_PLAN.md', content);
    });

    console.log('[AIDD] FIX_PLAN.md generated with verifiable tasks.');
  }

  /**
   * Maps a task to a UI-GATES Proposal.
   */
  async createProposalForTask(intent: Intent, task: Task): Promise<Proposal> {
    return {
      id: `prop_${task.id}_${Date.now()}`,
      intentId: intent.id,
      actorId: 'agent-aidd',
      action: task.description,
      resource: 'project-source', // Simplified
      rationale: `Part of intent: ${intent.goal}`,
      impact: task.authorityRequired === 'gated' ? 'high' : 'low',
      risk: 'Standard engineering risk',
      authorityRequested: task.authorityRequired as any,
      verificationPlan: task.verificationPlan,
      proposedAt: new Date(),
    };
  }
}
