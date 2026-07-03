"use client";

import { useState, useRef } from "react";
import { Upload, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface AvatarUploadProps {
  currentUrl: string;
  offsetX: number;
  offsetY: number;
  userId: string;
  onUpload: (url: string, offsetX: number, offsetY: number) => Promise<void>;
}

export default function AvatarUpload({ currentUrl, offsetX, offsetY, userId, onUpload }: AvatarUploadProps) {
  const [preview, setPreview] = useState(currentUrl);
  const [uploading, setUploading] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [currentOffsetX, setCurrentOffsetX] = useState(offsetX);
  const [currentOffsetY, setCurrentOffsetY] = useState(offsetY);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setUploading(true);

    try {
      // Generate filename: users/{userId}/avatar-{timestamp}
      const timestamp = Date.now();
      const filename = `users/${userId}/avatar-${timestamp}`;

      // Upload to Supabase Storage
      const { data, error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(filename, file, { upsert: false });

      if (uploadErr) throw uploadErr;

      // Get public URL
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(data.path);
      const publicUrl = urlData.publicUrl;

      // Show preview and adjustment UI
      setPreview(publicUrl);
      setCurrentOffsetX(0);
      setCurrentOffsetY(0);
      setShowAdjust(true);
    } catch (err: unknown) {
      setError((err as Error).message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const x = e.clientX - rect.left - centerX;
    const y = e.clientY - rect.top - centerY;
    setCurrentOffsetX(Math.max(-80, Math.min(80, x)));
    setCurrentOffsetY(Math.max(-80, Math.min(80, y)));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleSavePosition = async () => {
    try {
      await onUpload(preview, currentOffsetX, currentOffsetY);
      setShowAdjust(false);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-extrabold mb-2" style={{ color: "#9ca3af", letterSpacing: "0.8px" }}>
          CHANGE AVATAR
        </label>
        <label className="w-full flex items-center justify-center gap-2 py-3 rounded-xl cursor-pointer transition-all"
          style={{ border: "2px dashed #f3e8ff", background: "#fafafa" }}>
          <Upload size={16} style={{ color: "#a78bfa" }} />
          <span className="text-xs font-extrabold" style={{ color: "#7c3aed" }}>
            {uploading ? "Uploading..." : "Click to upload photo"}
          </span>
          <input type="file" accept="image/*" onChange={handleFileSelect} disabled={uploading} className="hidden" />
        </label>
      </div>

      {error && (
        <p className="text-xs font-semibold px-3 py-2 rounded-xl" style={{ background: "#fef2f2", color: "#ef4444" }}>
          {error}
        </p>
      )}

      {showAdjust && (
        <div className="bg-gradient-to-b rounded-2xl p-4" style={{ background: "linear-gradient(135deg, #fdf4ff 0%, #f3e8ff 100%)" }}>
          <p className="text-xs font-extrabold mb-3" style={{ color: "#7c3aed" }}>ADJUST POSITION</p>
          <p className="text-xs font-semibold mb-3" style={{ color: "#9ca3af" }}>Drag the image to center your face</p>

          <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onMouseDown={handleMouseDown}
            className="relative w-24 h-24 rounded-full overflow-hidden mx-auto mb-4 cursor-grab active:cursor-grabbing"
            style={{ border: "3px solid #e9d5ff", background: "#fff" }}
          >
            {preview && (
              <img
                ref={imageRef}
                src={preview}
                alt="Avatar preview"
                className="w-32 h-32 object-cover absolute"
                style={{
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${currentOffsetX}px), calc(-50% + ${currentOffsetY}px))`,
                  userSelect: "none",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setShowAdjust(false)}
              className="flex-1 py-2 rounded-xl text-xs font-extrabold"
              style={{ background: "#f3e8ff", color: "#7c3aed" }}
            >
              Cancel
            </button>
            <button
              onClick={handleSavePosition}
              disabled={uploading}
              className="flex-1 py-2 rounded-xl text-xs font-extrabold text-white flex items-center justify-center gap-1.5"
              style={{
                background: "linear-gradient(135deg, #ec4899, #8b5cf6)",
                opacity: uploading ? 0.7 : 1,
              }}
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : "Save Avatar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
