interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div role="alert" className="notice mb-3">
      <div className="flex items-center justify-between">
        <span>Message update</span>
        <button className="underline" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-xs text-red-600">{message}</pre>
    </div>
  );
}

