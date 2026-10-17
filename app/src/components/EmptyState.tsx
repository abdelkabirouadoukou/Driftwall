interface Props {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

export default function EmptyState({ title, body, actionLabel, onAction }: Props) {
  return (
    <div className="empty">
      <div className="empty-mark" aria-hidden="true" />
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <button type="button" className="btn primary" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
