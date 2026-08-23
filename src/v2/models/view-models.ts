/**
 * Phase 1 stubs only. UI must bind to these shapes, not Firestore field names.
 * Real mappers land in later phases.
 */

export type OpportunityViewModel = {
  id: string;
  displayNumber: string;
  type: string;
  status: string;
};

export type BrokerViewModel = {
  id: string;
  displayName: string;
};

export type OfficeViewModel = {
  id: string;
  displayName: string;
};

export type MatchViewModel = {
  id: string;
  score: number;
};
