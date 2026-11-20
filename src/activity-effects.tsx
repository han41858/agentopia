import type { ReactNode } from 'react';
import {
  Check,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserRound,
} from 'lucide-react';
import type { ActivityProfile } from '../server/activity.ts';

export function monsterGrowth(commits = 0) {
  return Math.min(17, Math.round(3 * Math.log2(1 + commits)));
}

function effectCount(count = 0) {
  return count > 0 ? Math.min(3, 1 + Math.floor(Math.log10(count))) : 0;
}

export function ActivityAura({
  activity,
  children,
}: {
  activity?: ActivityProfile;
  children: ReactNode;
}) {
  const discussion = effectCount(
    (activity?.issueComments ?? 0) + (activity?.pullComments ?? 0),
  );
  const runes = effectCount(activity?.reviews);
  const participants = Math.min(3, activity?.participants ?? 0);
  const opinion = activity?.opinion?.state;
  return (
    <span className="activity-aura" aria-hidden="true">
      {discussion > 0 && (
        <span className="aura-discussion">
          {Array.from({ length: discussion }, (_, i) => (
            <MessageCircle key={i} size={11} />
          ))}
        </span>
      )}
      <span className="aura-core">{children}</span>
      {runes > 0 && (
        <span className="aura-runes">
          {Array.from({ length: runes }, (_, i) => (
            <Sparkles key={i} size={11} />
          ))}
        </span>
      )}
      {participants > 0 && (
        <span className="aura-crowd">
          {Array.from({ length: participants }, (_, i) => (
            <UserRound key={i} size={10} />
          ))}
        </span>
      )}
      {opinion && (
        <span
          className={`aura-opinion ${opinion === 'APPROVED' ? 'approved' : 'changes'}`}
        >
          {opinion === 'APPROVED' ? (
            <Check size={12} />
          ) : (
            <ShieldAlert size={12} />
          )}
        </span>
      )}
    </span>
  );
}
