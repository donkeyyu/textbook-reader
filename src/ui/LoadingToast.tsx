export function LoadingToast() {
  return <div className="loading-toast" role="status">
    <svg className="loading-toast-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity=".2" />
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
    <span>载入中...</span>
  </div>;
}
