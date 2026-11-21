import type { ReactNode } from 'react';
import { Check, MessageCircle, ShieldAlert, Sparkles } from 'lucide-react';
import type { ActivityProfile } from '../server/activity.ts';

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
      <ReviewOpinionBadge opinion={activity?.opinion?.state} />
    </span>
  );
}

export function ReviewOpinionBadge({
  opinion,
}: {
  opinion?: NonNullable<ActivityProfile['opinion']>['state'];
}) {
  if (!opinion) return null;
  return (
    <span
      className={`aura-opinion ${opinion === 'APPROVED' ? 'approved' : 'changes'}`}
    >
      {opinion === 'APPROVED' ? <Check size={12} /> : <ShieldAlert size={12} />}
    </span>
  );
}
