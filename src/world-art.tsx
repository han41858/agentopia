import adventurerClaude from '../assets/characters/adventurer-claude.svg';
import adventurerCodex from '../assets/characters/adventurer-codex.svg';
import monsterBoss from '../assets/characters/monster-boss.svg';
import monster from '../assets/characters/monster.svg';
import partyLeader from '../assets/characters/party-leader.svg';
import portalKeeper from '../assets/characters/portal-keeper.svg';
import architectureWorkshop from '../assets/facilities/architecture-workshop.svg';
import controlTower from '../assets/facilities/control-tower.svg';
import forge from '../assets/facilities/forge.svg';
import garden from '../assets/facilities/garden.svg';
import guardTower from '../assets/facilities/guard-tower.svg';
import library from '../assets/facilities/library.svg';
import machineWorkshop from '../assets/facilities/machine-workshop.svg';
import observatory from '../assets/facilities/observatory.svg';
import portal from '../assets/facilities/portal.svg';
import supplyDepot from '../assets/facilities/supply-depot.svg';
import trainingGround from '../assets/facilities/training-ground.svg';
import wallRepair from '../assets/facilities/wall-repair.svg';
import legacyArchive from '../assets/kingdom/legacy-archive.svg';
import legacyHallOfHeroes from '../assets/kingdom/legacy-hall-of-heroes.svg';
import legacyMonument from '../assets/kingdom/legacy-monument.svg';
import legacySageLibrary from '../assets/kingdom/legacy-sage-library.svg';
import palace from '../assets/kingdom/palace.svg';

const images = {
  adventurerClaude,
  adventurerCodex,
  monsterBoss,
  monster,
  partyLeader,
  portalKeeper,
  architectureWorkshop,
  controlTower,
  forge,
  garden,
  guardTower,
  library,
  machineWorkshop,
  observatory,
  portal,
  supplyDepot,
  trainingGround,
  wallRepair,
  legacyArchive,
  legacyHallOfHeroes,
  legacyMonument,
  legacySageLibrary,
  palace,
} as const;

export type WorldSprite = keyof typeof images;

export function WorldArt({
  sprite,
  size,
  className,
}: {
  sprite: WorldSprite;
  size: number;
  className?: string;
}) {
  return (
    <img
      src={images[sprite]}
      width={size}
      height={size}
      className={className}
      alt=""
      draggable={false}
    />
  );
}
