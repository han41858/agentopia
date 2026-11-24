import { objectSizes, monsterSize } from './object-sizes.ts';
import { WorldArt } from './world-art.tsx';
import { Hammer, ScrollText, Swords, X } from 'lucide-react';
import type { Adventurer, AdventurerRole, Agent } from '../server/model.ts';

export const agentNames: Record<Agent, string> = {
  codex: 'Codex',
  claude: 'Claude',
};

const roleNames: Record<AdventurerRole, string> = {
  develop: '개발',
  review: '리뷰',
};

export function MonsterGlyph({
  boss = false,
  defeated = false,
  reopened = false,
  commits = 0,
}) {
  const size = monsterSize(boss, commits);
  return (
    <span
      className={`monster-glyph${boss ? ' boss' : ''}${defeated ? ' defeated' : ''}${reopened ? ' revived' : ''}`}
      aria-hidden="true"
    >
      <WorldArt sprite={boss ? 'monsterBoss' : 'monster'} size={size} />
      {defeated && <X className="monster-remains" size={11} />}
      {reopened && <span className="monster-revival" />}
    </span>
  );
}

type PartyGlyphProps = { className?: string };

export function PartyLeaderGlyph({ className }: PartyGlyphProps) {
  return (
    <WorldArt
      sprite="partyLeader"
      size={objectSizes.officer}
      className={className}
    />
  );
}

export function AdventurerGlyph({
  agent,
  active,
  fallen,
  forge = false,
}: {
  agent: Agent;
  active?: AdventurerRole;
  fallen?: boolean;
  forge?: boolean;
}) {
  const RoleIcon =
    active === 'develop' ? (forge ? Hammer : Swords) : ScrollText;
  return (
    <span
      className={`adventurer-glyph ${agent}${active ? ` active ${active}` : ''}${fallen ? ' fallen' : ''}${forge ? ' crafting' : ''}`}
      aria-hidden="true"
    >
      <WorldArt
        sprite={agent === 'codex' ? 'adventurerCodex' : 'adventurerClaude'}
        size={objectSizes.adventurer}
        className="adventurer-avatar"
      />
      {active && <RoleIcon className="adventurer-role" size={10} />}
    </span>
  );
}

export function partyLabel(member: Adventurer, resting: string) {
  const task = member.fallen
    ? '쓰러짐'
    : member.active
      ? `${roleNames[member.active]} 중`
      : resting;
  return `${agentNames[member.agent]} · ${task}`;
}

export function partyLeaderLabel(state: 'active' | 'resting') {
  return `GitHub Actions · 파티장 · ${state === 'active' ? 'CI' : '대기'}`;
}

export function AdventurerParty({
  members,
  resting,
  detailed = false,
  leader,
  forge = false,
  showTitles = true,
}: {
  members: Adventurer[];
  resting: string;
  detailed?: boolean;
  leader?: 'active' | 'resting';
  forge?: boolean;
  showTitles?: boolean;
}) {
  if (!leader && !members.length) return null;
  return (
    <span className={`adventurer-party${detailed ? ' detailed' : ''}`}>
      {leader && (
        <span
          className="adventurer"
          title={showTitles ? partyLeaderLabel(leader) : undefined}
        >
          <PartyLeaderGlyph
            className={
              leader === 'active'
                ? 'working-party-leader'
                : 'resting-party-leader'
            }
          />
          {detailed && <strong>{partyLeaderLabel(leader)}</strong>}
        </span>
      )}
      {members.map((member) => (
        <span
          className="adventurer"
          key={member.agent}
          title={showTitles ? partyLabel(member, resting) : undefined}
        >
          <AdventurerGlyph
            agent={member.agent}
            active={member.fallen ? undefined : member.active}
            fallen={member.fallen}
            forge={forge}
          />
          {detailed && (
            <span>
              <strong>{partyLabel(member, resting)}</strong>
              <small>
                참여 역할{' '}
                {member.roles.map((role) => roleNames[role]).join(' · ')}
              </small>
            </span>
          )}
        </span>
      ))}
    </span>
  );
}
