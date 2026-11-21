import { objectSizes } from './object-sizes.ts';
import { WorldArt, type WorldSprite } from './world-art.tsx';
import {
  BookOpen,
  Bolt,
  RadioTower,
  Package,
  Telescope,
  Hammer,
  KeyRound,
  Rocket,
  Sprout,
  Target,
  Wrench,
} from 'lucide-react';
import type { FacilityKind } from './facility-kind.ts';

export const facilities = {
  workshop: { sprite: 'architectureWorkshop', name: '공방', Tool: Wrench },
  forge: { sprite: 'forge', name: '대장간', Tool: Hammer },
  wall: { sprite: 'wallRepair', name: '성벽 수리 현장', Tool: Hammer },
  garden: { sprite: 'garden', name: '정원', Tool: Sprout },
  library: { sprite: 'library', name: '도서관', Tool: BookOpen },
  training: { sprite: 'trainingGround', name: '훈련장', Tool: Target },
  machine: { sprite: 'machineWorkshop', name: '기계 공방', Tool: Bolt },
  repair: { sprite: 'architectureWorkshop', name: '건축 공방', Tool: Wrench },
  guard: { sprite: 'guardTower', name: '경비탑', Tool: KeyRound },
  control: { sprite: 'controlTower', name: '관제탑', Tool: RadioTower },
  supply: { sprite: 'supplyDepot', name: '보급소', Tool: Package },
  observatory: { sprite: 'observatory', name: '관측소', Tool: Telescope },
  portal: { sprite: 'portal', name: '릴리즈 포탈', Tool: Rocket },
} satisfies Record<
  FacilityKind,
  { sprite: WorldSprite; name: string; Tool: typeof Hammer }
>;

export function FacilityGlyph({ kind }: { kind: FacilityKind }) {
  return (
    <WorldArt
      size={objectSizes.facility}
      sprite={facilities[kind].sprite}
      className="facility-sprite"
    />
  );
}
