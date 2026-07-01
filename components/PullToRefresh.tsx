"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const PULL_THRESHOLD = 64;
const MAX_PULL = 96;

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  className?: string;
  children: React.ReactNode;
}

export default function PullToRefresh({ onRefresh, className, children }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const startY = useRef(0);
  const dragging = useRef(false);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Touchmove needs preventDefault() to stop native scroll bounce while pulling,
  // which requires a non-passive listener — React's synthetic onTouchMove is passive.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (el.scrollTop <= 0) {
        startY.current = e.touches[0].clientY;
        dragging.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!dragging.current || refreshingRef.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0 || el.scrollTop > 0) {
        dragging.current = false;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      e.preventDefault();
      const next = Math.min(delta * 0.5, MAX_PULL);
      pullRef.current = next;
      setPull(next);
    };

    const handleTouchEnd = async () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (pullRef.current >= PULL_THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(PULL_THRESHOLD);
        try {
          await onRefreshRef.current();
        } finally {
          refreshingRef.current = false;
          pullRef.current = 0;
          setRefreshing(false);
          setPull(0);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    el.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return (
    <div ref={containerRef} className={className} style={{ overscrollBehaviorY: "contain" }}>
      <div
        className="flex items-center justify-center overflow-hidden"
        style={{ height: pull, transition: dragging.current ? "none" : "height 0.2s ease" }}
      >
        <RefreshCw
          size={18}
          className={refreshing ? "animate-spin" : ""}
          style={{
            color: "#a78bfa",
            opacity: Math.min(pull / PULL_THRESHOLD, 1),
            transform: `rotate(${Math.min(pull / PULL_THRESHOLD, 1) * 360}deg)`,
          }}
        />
      </div>
      {children}
    </div>
  );
}
