import {
  BookOpen,
  Bolt,
  Hammer,
  KeyRound,
  Rocket,
  Sprout,
  Target,
  Wrench,
} from 'lucide-react';
import type { FacilityKind } from './facility-kind.ts';

export const facilities = {
  workshop: { name: '공방', Tool: Wrench },
  forge: { name: '대장간', Tool: Hammer },
  wall: { name: '성벽 수리 현장', Tool: Hammer },
  garden: { name: '정원', Tool: Sprout },
  library: { name: '도서관', Tool: BookOpen },
  training: { name: '훈련장', Tool: Target },
  machine: { name: '기계 공방', Tool: Bolt },
  repair: { name: '정비소', Tool: Wrench },
  guard: { name: '경비탑', Tool: KeyRound },
  portal: { name: '릴리즈 포탈', Tool: Rocket },
} satisfies Record<FacilityKind, { name: string; Tool: typeof Hammer }>;

type Sprite = {
  fill: string;
  structure: string;
  trim: string;
  highlight: string;
};

// Each sprite uses the same 24 × 24 pixel grid and three layers.
const sprites: Record<FacilityKind, Sprite> = {
  workshop: {
    fill: '#ba966f',
    structure: 'M3 10H6V7H9V4H15V7H18V10H21V21H3Z',
    trim: 'M3 10H6V7H9V4H15V7H18V10H21V13H3Z',
    highlight: 'M10 15H14V21H10Z M5 15H8V18H5Z M16 15H19V18H16Z',
  },
  forge: {
    fill: '#a37a5e',
    structure: 'M3 10H6V7H14V3H17V8H20V10H22V21H3Z',
    trim: 'M3 10H6V7H14V3H17V8H20V10H22V13H3Z M4 19H20V21H4Z',
    highlight: 'M9 21V16H10V15H11V13H13V15H14V16H15V21Z',
  },
  wall: {
    fill: '#b7abb5',
    structure: 'M3 5H7V8H10V5H14V8H17V5H21V21H3Z',
    trim: 'M3 5H7V8H10V5H14V8H17V5H21V11H3Z M3 16H21V17H3Z',
    highlight: 'M5 12H7V15H5Z M8 18H11V20H8Z M14 12H18V14H14Z M17 18H20V20H17Z',
  },
  garden: {
    fill: '#75b981',
    structure: 'M3 13H5V10H8V8H11V5H14V8H17V10H20V13H22V20H19V22H6V20H3Z',
    trim: 'M3 17H22V20H19V22H6V20H3Z',
    highlight:
      'M11 6H14V10H11Z M6 12H9V15H6Z M16 12H19V15H16Z M11 15H14V18H11Z',
  },
  library: {
    fill: '#c79ab7',
    structure:
      'M2 9H6V7H9V5H12V3H14V5H17V7H20V9H22V12H20V19H22V22H2V19H4V12H2Z',
    trim: 'M2 9H6V7H9V5H12V3H14V5H17V7H20V9H22V12H2Z M2 19H22V22H2Z',
    highlight: 'M5 12H7V19H5Z M10 12H12V19H10Z M15 12H17V19H15Z',
  },
  training: {
    fill: '#d5a66c',
    structure: 'M4 7H7V11H9V5H16V7H18V11H20V7H22V21H3V10H4Z',
    trim: 'M4 7H7V11H9V13H20V7H22V21H3V10H4Z',
    highlight: 'M11 6H15V8H17V12H15V14H11V12H9V8H11Z M12 9H14V11H12Z',
  },
  machine: {
    fill: '#97b9cb',
    structure: 'M2 11H5V7H8V10H11V6H15V3H19V7H21V11H23V21H2Z',
    trim: 'M2 18H23V21H2Z M5 7H8V10H11V6H15V3H19V7H21V11H2V10H5Z',
    highlight: 'M6 13H9V17H6Z M12 13H15V17H12Z M18 13H21V17H18Z M17 3H19V6H17Z',
  },
  repair: {
    fill: '#bf9c72',
    structure: 'M2 7H5V5H19V7H22V22H2Z',
    trim: 'M2 7H5V5H19V7H22V11H2Z M6 13H18V22H6Z',
    highlight: 'M7 13H17V15H7Z M7 17H17V18H7Z M7 20H17V21H7Z',
  },
  guard: {
    fill: '#a5afc5',
    structure: 'M6 3H9V6H11V3H14V6H16V3H19V10H17V19H20V22H5V19H8V10H6Z',
    trim: 'M6 3H9V6H11V3H14V6H16V3H19V10H6Z M5 19H20V22H5Z',
    highlight: 'M11 12H14V16H11Z M16 3H19V5H16Z',
  },
  portal: {
    fill: '#b59ce0',
    structure: 'M3 21V10H5V7H7V5H10V3H15V5H18V7H20V10H22V21Z',
    trim: 'M7 21V11H9V8H11V7H14V8H16V11H18V21Z',
    highlight: 'M12 9H14V12H16V14H14V17H12V14H10V12H12Z M3 20H22V22H3Z',
  },
};

export function FacilityGlyph({ kind }: { kind: FacilityKind }) {
  const sprite = sprites[kind];
  return (
    <svg
      className="facility-sprite"
      viewBox="0 0 24 24"
      shapeRendering="crispEdges"
      width="25"
      height="25"
      aria-hidden="true"
    >
      <path d={sprite.structure} fill={sprite.fill} />
      <path d={sprite.trim} className="facility-sprite-trim" />
      <path d={sprite.highlight} className="facility-sprite-highlight" />
    </svg>
  );
}
