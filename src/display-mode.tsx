import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from 'react';
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
  { value: 'world', Icon: MapIcon },
  { value: 'simple', Icon: Workflow },
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
  const descriptionId = useId();
  const isSimple = mode === 'simple';
  const currentMode = isSimple ? '현재: 간단 모드' : '현재: 월드 모드';

  return (
    <button
      className="mode-switch"
      type="button"
      aria-label="간단 모드"
      aria-pressed={isSimple}
      aria-describedby={descriptionId}
      title={currentMode}
      onClick={() => select(isSimple ? 'world' : 'simple')}
    >
      <span id={descriptionId} hidden>
        {currentMode}
      </span>
      {options.map(({ value, Icon }) => (
        <span
          key={value}
          className="mode-switch-option"
          data-active={mode === value}
        >
          <Icon size={17} aria-hidden="true" />
        </span>
      ))}
    </button>
  );
}
