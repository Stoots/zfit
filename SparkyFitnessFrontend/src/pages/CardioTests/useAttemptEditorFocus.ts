import { useEffect, useRef, useState } from 'react';

export function useAttemptEditorFocus(editingId: string | null) {
  const [focusRequest, setFocusRequest] = useState(0);
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
  }, [editingId, focusRequest]);

  const focusEditor = (button: HTMLButtonElement) => {
    editButtonRef.current = button;
    setFocusRequest((request) => request + 1);
  };

  return { headingRef, focusEditor };
}
