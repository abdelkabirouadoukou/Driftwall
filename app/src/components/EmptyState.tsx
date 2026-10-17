import { Rocket } from 'lucide-react';

interface Props {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}

export default function EmptyState({ title, body, actionLabel, onAction, icon }: Props) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true">
        {icon ?? <Rocket size={22} />}
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
      {actionLabel && onAction && (
        <button type="button" className="btn primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
