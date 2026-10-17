import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type LucideIcon } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  x: number;
  y: number;
  items: readonly (MenuItem | 'sep')[];
  onClose: () => void;
}

/**
 * Flat, keyboard-dismissable context menu. Rendered in a fixed layer and
 * clamped to the viewport so it never opens off-screen.
 */
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport once we know the rendered size.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // Focus the menu so Escape works without an extra click.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item, index) =>
        item === 'sep' ? (
          <div key={index} className="sep" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className={item.danger ? 'danger' : undefined}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon && <item.icon size={14} aria-hidden="true" />}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
