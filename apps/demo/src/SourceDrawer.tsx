import { useEffect, useRef } from "react";

type SourceDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  linkText: string;
  href: string;
  resolvedContent?: string | null;
  error?: string | null;
};

export function SourceDrawer({
  isOpen,
  onClose,
  linkText,
  href,
  resolvedContent,
  error,
}: SourceDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="source-drawer-backdrop" onClick={onClose} />
      <div ref={drawerRef} className={`source-drawer ${isOpen ? "open" : ""}`}>
        <div className="source-drawer-header">
          <h2 className="source-drawer-title">Source</h2>
          <button
            type="button"
            className="source-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div className="source-drawer-content">
          <div className="source-drawer-section">
            <h3 className="source-drawer-label">Citation</h3>
            <p className="source-drawer-citation">{linkText}</p>
          </div>

          {resolvedContent && (
            <div className="source-drawer-section">
              <h3 className="source-drawer-label">Source Content</h3>
              <div
                className="source-drawer-resolved"
                dangerouslySetInnerHTML={{ __html: resolvedContent }}
              />
            </div>
          )}

          {error && (
            <div className="source-drawer-section">
              <p className="source-drawer-error">{error}</p>
            </div>
          )}

          <div className="source-drawer-section">
            <h3 className="source-drawer-label">Link</h3>
            <p className="source-drawer-href">{href}</p>
          </div>
        </div>
      </div>
    </>
  );
}
