import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';

export type ToastKind = 'info' | 'error';

interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

interface ToastApi {
  /** Show a transient toast. `kind` defaults to 'info'. */
  toast: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, text, kind }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={item.kind === 'error' ? 'toast error' : 'toast'}>
            {item.kind === 'error' ? (
              <XCircle size={16} color="var(--danger)" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={16} color="var(--secondary)" aria-hidden="true" />
            )}
            <span className="small">{item.text}</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn icon ghost"
              style={{ height: 22, width: 22 }}
              aria-label="Dismiss notification"
              onClick={() => setItems((prev) => prev.filter((t) => t.id !== item.id))}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

/** Convenience hook: shows `text` once when it changes (non-empty). */
export function useToastEffect(text: string, kind: ToastKind = 'info') {
  const { toast } = useToast();
  useEffect(() => {
    if (text) toast(text, kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
}
