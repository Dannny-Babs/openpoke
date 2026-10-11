import { useCallback, useLayoutEffect, useRef, useState } from "react";

interface AutoScrollOptions {
  items: ReadonlyArray<unknown>;
  isWaiting: boolean;
  scopeKey?: string;
}

const BOTTOM_THRESHOLD = 80;

export const useAutoScroll = ({ scopeKey }: AutoScrollOptions) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const [away, setAway] = useState(false);

  const measure = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setAway(distance > BOTTOM_THRESHOLD);
  }, []);

  const scrollToBottom = useCallback((_behavior: ScrollBehavior = "auto") => {
    const container = scrollContainerRef.current;
    followingRef.current = true;
    setAway(false);
    if (!container) return;
    const top = Math.max(0, container.scrollHeight - container.clientHeight);
    // Progress polling must not start overlapping smooth-scroll animations.
    if (Math.abs(container.scrollTop - top) > 1) container.scrollTop = top;
  }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    followingRef.current = distance <= BOTTOM_THRESHOLD;
    setAway(!followingRef.current);
  }, []);

  const anchor = useCallback(() => {
    if (followingRef.current) scrollToBottom();
    else measure();
  }, [measure, scrollToBottom]);

  useLayoutEffect(() => {
    followingRef.current = true;
    scrollToBottom();
  }, [scopeKey, scrollToBottom]);

  // Measure committed layout, not array identity. Unchanged polls do no scrolling.
  // Also reconnect if the scrolling node or its content wrapper has been replaced.
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    anchor();
    const observer = new ResizeObserver(anchor);
    observer.observe(container);
    const content = container.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });

  return { scrollContainerRef, handleScroll, scrollToBottom, away };
};
