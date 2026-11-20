import { Bug, Crown, ScrollText, Swords } from 'lucide-react';
import type { Adventurer, AdventurerRole, Agent } from '../server/model.ts';

export const agentNames: Record<Agent, string> = {
  codex: 'Codex',
  claude: 'Claude',
};

const roleNames: Record<AdventurerRole, string> = {
  develop: '개발',
  review: '리뷰',
};

export function MonsterGlyph({ boss = false, defeated = false }) {
  return (
    <span
      className={`monster-glyph${boss ? ' boss' : ''}${defeated ? ' defeated' : ''}`}
      aria-hidden="true"
    >
      {boss && <Crown className="monster-crown" size={12} />}
      <Bug size={boss ? 25 : 21} strokeWidth={1.7} />
    </span>
  );
}

export function AdventurerGlyph({
  agent,
  active,
  fallen,
}: {
  agent: Agent;
  active?: AdventurerRole;
  fallen?: boolean;
}) {
  const RoleIcon = active === 'develop' ? Swords : ScrollText;
  return (
    <span
      className={`adventurer-glyph ${agent}${active ? ` active ${active}` : ''}${fallen ? ' fallen' : ''}`}
      aria-hidden="true"
    >
      <span className="adventurer-avatar" />
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
}: {
  members: Adventurer[];
  resting: string;
  detailed?: boolean;
}) {
  if (!members.length) return null;
  return (
    <span className={`adventurer-party${detailed ? ' detailed' : ''}`}>
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
