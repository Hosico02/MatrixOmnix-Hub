export interface ProposalCandidate {
  archetype: string;
  proposalType: 'add_check' | 'adjust_weight' | 'remove_check' | 'reword';
  bodyMd: string;
  rationaleMd: string;
  source: 'rule' | 'llm';
  evidenceFindingIds: string[];
}
