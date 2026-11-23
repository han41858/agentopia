import { createContext, useContext, useState, type ReactNode } from 'react';
import { Map as MapIcon, Workflow } from 'lucide-react';

type Mode = 'world' | 'simple';
const storageKey = 'agentopia.display-mode';
const ModeContext = createContext<{
  mode: Mode;
  select: (value: Mode) => void;
}>({
  mode: 'world',
  select: () => {},
});
const options = [
  { value: 'world', label: '월드 모드', Icon: MapIcon },
  { value: 'simple', label: '간단 모드', Icon: Workflow },
] as const;

export function useDisplayMode() {
  return useContext(ModeContext).mode;
}

export function DisplayModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(storageKey) === 'simple' ? 'simple' : 'world';
    } catch {
      return 'world';
    }
  });

  function select(value: Mode) {
    setMode(value);
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // Keep the selection for this visit when storage is unavailable.
    }
  }

  return (
    <ModeContext.Provider value={{ mode, select }}>
      <div data-display-mode={mode}>{children}</div>
    </ModeContext.Provider>
  );
}

export function ModeSwitch() {
  const { mode, select } = useContext(ModeContext);
  return (
    <div className="mode-switch" role="group" aria-label="지도 표시 모드">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          aria-label={label}
          title={label}
          onClick={() => select(value)}
        >
          <Icon size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
