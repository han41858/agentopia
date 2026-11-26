// Every symbol uses the RPG sprite's aspect ratio and its existing display box.
function symbol(body: string, viewBox = '0 0 48 48') {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="#294455" stroke="#9cbbc9" stroke-width="1.7">${body}</svg>`,
    )
  );
}

function badge(letters: string, fill: string) {
  return symbol(
    `<circle cx="24" cy="24" r="20" fill="${fill}"/><text x="24" y="30" text-anchor="middle" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="white" stroke="none">${letters}</text>`,
  );
}

const simpleHub = symbol(
  '<rect x="7" y="7" width="34" height="34" rx="3"/><rect x="12" y="12" width="24" height="24" rx="1" fill="none"/>',
);
export const simpleFacility = symbol(
  '<rect x="6" y="6" width="36" height="36" rx="3"/>',
);
export const simpleSprites = {
  palace: simpleHub,
  plaza: symbol(
    '<rect x="28" y="16" width="40" height="40" rx="3"/>',
    '0 0 96 72',
  ),
  moatBridge: symbol('<path d="M48 0v28" fill="none"/>', '0 0 96 28'),
  monster: symbol(
    '<circle cx="24" cy="24" r="18" fill="#384353" stroke="#c1b4c8"/>',
  ),
  monsterBoss: symbol(
    '<path d="M13 6h22l10 18-10 18H13L3 24z" fill="#473d51" stroke="#d0b9db"/>',
  ),
  adventurerCodex: badge('CX', '#27564e'),
  adventurerClaude: badge('CL', '#704934'),
  partyLeader: badge('A', '#3e5176'),
};
export const simpleHeritage = symbol(
  '<rect x="18" y="5" width="12" height="36" rx="1" fill="#6c97a0"/><path d="M12 42h24"/>',
);
