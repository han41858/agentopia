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
  | 'control'
  | 'supply'
  | 'observatory'
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
  '👷': 'control',
  '💚': 'control',
  '🔧': 'supply',
  '📦': 'supply',
  '⬆': 'supply',
  '⬇': 'supply',
  '📈': 'observatory',
  '🔊': 'observatory',
  '🚀': 'portal',
};

export function facilityKind(title: string): FacilityKind {
  const [first] = title.trimStart();
  return kindsByMoji[first] ?? 'workshop';
}

export function isCurrentFacility(pull: {
  merged?: boolean;
  cancelled?: boolean;
}) {
  return !pull.merged && !pull.cancelled;
}
