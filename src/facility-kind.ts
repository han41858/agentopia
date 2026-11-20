export type FacilityKind =
  | 'workshop'
  | 'forge'
  | 'wall'
  | 'garden'
  | 'library'
  | 'training'
  | 'machine'
  | 'repair'
  | 'guard'
  | 'portal';

const kindsByMoji: Readonly<Record<string, FacilityKind>> = {
  '✨': 'forge',
  '🐛': 'wall',
  '💄': 'garden',
  '📝': 'library',
  '✅': 'training',
  '⚡': 'machine',
  '♻': 'repair',
  '🔒': 'guard',
  '🚀': 'portal',
};

export function facilityKind(title: string): FacilityKind {
  const [first] = title.trimStart();
  return kindsByMoji[first] ?? 'workshop';
}

const mapHistoryWindow = 24 * 60 * 60_000;

export function isHistoricFacility(finishedAt?: string, now = Date.now()) {
  return (
    finishedAt !== undefined && now - Date.parse(finishedAt) >= mapHistoryWindow
  );
}
