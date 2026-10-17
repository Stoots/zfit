import { useEffect, useRef } from 'react';

export function useAttemptEditorFocus(editingId: string | null) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!editButtonRef.current) return;
    const target = editingId ? headingRef.current : editButtonRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      block: editingId ? 'start' : 'center',
      behavior: 'instant',
    });
    if (!editingId) editButtonRef.current = null;
  }, [editingId]);

  return { headingRef, editButtonRef };
}
