import type { ReactNode } from 'react';
import { Check, ShieldAlert, Sparkles } from 'lucide-react';
import type { ActivityProfile } from '../server/activity.ts';

function effectCount(count = 0) {
  return count > 0 ? Math.min(3, 1 + Math.floor(Math.log10(count))) : 0;
}

export function ActivityAura({
  activity,
  facility = false,
  children,
}: {
  activity?: ActivityProfile;
  facility?: boolean;
  children: ReactNode;
}) {
  const runes = effectCount(activity?.reviews);
  return (
    <span className="activity-aura" aria-hidden="true">
      <span className="aura-core">{children}</span>
      {runes > 0 && (
        <span className="aura-runes">
          {Array.from({ length: runes }, (_, i) => (
            <Sparkles key={i} size={11} />
          ))}
        </span>
      )}
      {!facility && <ReviewOpinionBadge opinion={activity?.opinion?.state} />}
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
