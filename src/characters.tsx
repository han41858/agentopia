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
  const size = (boss ? 25 : 21) + growth;
  return (
    <span
      className={`monster-glyph${boss ? ' boss' : ''}${defeated ? ' defeated' : ''}${reopened ? ' revived' : ''}`}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 20 20"
        shapeRendering="crispEdges"
      >
        {boss ? (
          <>
            <path
              fill="#302038"
              d="M1 1h3v3h3v1h6V4h3V1h3v8h-2v2h2v6h-3v2h-4v-2H8v2H4v-2H1v-6h2V9H1z"
            />
            <path
              fill="#ffd582"
              d="M2 2h1v3h3v2H3V6H2z M18 2h-1v3h-3v2h3V6h1z"
            />
            <path
              fill="#be6682"
              d="M6 6h8v2h2v4h2v4h-4v2h-2v-3H8v3H5v-2H2v-4h2V8h2z"
            />
            <path
              fill="#42283f"
              d="M5 9h3v1h1v2H6v-1H5z M15 9h-3v1h-1v2h3v-1h1z M8 13h4v2H8z"
            />
            <path
              fill="#ffdfac"
              d="M7 10h1v1H7z M12 10h1v1h-1z M7 13h1v2H7z M12 13h1v2h-1z"
            />
          </>
        ) : (
          <>
            <path
              fill="#253d39"
              d="M7 4h6v2h3v3h2v3h1v5h-3v1H4v-1H1v-5h1V9h2V6h3z"
            />
            <path fill="#78bd86" d="M7 6h6v2h3v4h2v4H3v-4h1V9h3z" />
            <path fill="#bce4a3" d="M7 7h4v1H8v2H6V8h1z" />
            <path fill="#283a38" d="M7 11h2v3H7z M12 11h2v3h-2z" />
          </>
        )}
      </svg>
      {defeated && <X className="monster-remains" size={11} />}
      {reopened && <span className="monster-revival" />}
    </span>
  );
}

type PartyGlyphProps = { size?: number; className?: string };

function PartySprite({
  role,
  size = 20,
  className = '',
}: PartyGlyphProps & { role: 'actions' | 'release' }) {
  return (
    <span
      aria-hidden="true"
      className={`adventurer-avatar party-sprite ${role} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function PartyLeaderGlyph(props: PartyGlyphProps) {
  return <PartySprite role="actions" {...props} />;
}

export function PortalKeeperGlyph(props: PartyGlyphProps) {
  return <PartySprite role="release" {...props} />;
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
  forge = false,
}: {
  members: Adventurer[];
  resting: string;
  detailed?: boolean;
  forge?: boolean;
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
