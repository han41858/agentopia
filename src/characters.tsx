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
  growth = 0,
}) {
  const size = (boss ? 54 : 48) + growth;
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

type PartyGlyphProps = { size?: number; className?: string };

export function PartyLeaderGlyph(props: PartyGlyphProps) {
  return <WorldArt sprite="partyLeader" {...props} />;
}

export function PortalKeeperGlyph(props: PartyGlyphProps) {
  return <WorldArt sprite="portalKeeper" {...props} />;
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

export function AdventurerParty({
  members,
  resting,
  detailed = false,
  leader = false,
  forge = false,
}: {
  members: Adventurer[];
  resting: string;
  detailed?: boolean;
  leader?: boolean;
  forge?: boolean;
}) {
  if (!leader && !members.length) return null;
  return (
    <span className={`adventurer-party${detailed ? ' detailed' : ''}`}>
      {leader && (
        <span className="adventurer" title="GitHub Actions · 파티장 · CI">
          <PartyLeaderGlyph className="working-party-leader" />
        </span>
      )}
      {members.map((member) => (
        <span
          className="adventurer"
          key={member.agent}
          title={partyLabel(member, resting)}
        >
          <AdventurerGlyph
            agent={member.agent}
            active={member.active}
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
