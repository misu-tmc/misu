export function PageLoading({ label = 'Loading…' }) {
  return (
    <div class="page-loading" role="status">
      <span class="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function PageError({ message, onRetry }) {
  return (
    <div class="page-empty" role="alert">
      <p>{message || 'Something went wrong.'}</p>
      {onRetry && <button class="btn btn-ghost btn-sm" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, message, action }) {
  return (
    <div class="page-empty">
      {title && <h2>{title}</h2>}
      <p>{message}</p>
      {action}
    </div>
  );
}