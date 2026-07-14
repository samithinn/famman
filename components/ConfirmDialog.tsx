"use client";

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title = "Delete this?",
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(61,53,82,0.32)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#FFFBFE",
          borderRadius: 24,
          padding: "30px 28px 24px",
          width: 340,
          maxWidth: "100%",
          boxShadow: "0 24px 60px rgba(108,92,231,0.28)",
          border: "1px solid #F1EDFA",
          textAlign: "center",
          fontFamily: "'Nunito', sans-serif",
        }}
      >
        <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12 }}>🗑️</div>
        <div style={{ fontWeight: 800, fontSize: 17.5, color: "#3D3552", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "#8B84A0", marginBottom: 22, lineHeight: 1.55, whiteSpace: "pre-line" }}>{message}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 14,
              border: "1.5px solid #EAE5F7",
              background: "#fff",
              color: "#8B84A0",
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 800,
              fontSize: 13.5,
              cursor: "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "11px 0",
              borderRadius: 14,
              border: "none",
              background: "linear-gradient(135deg, #FFA6C9, #FF7FA6)",
              color: "#fff",
              fontFamily: "'Nunito', sans-serif",
              fontWeight: 800,
              fontSize: 13.5,
              cursor: "pointer",
              boxShadow: "0 8px 18px rgba(255,127,166,0.35)",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
