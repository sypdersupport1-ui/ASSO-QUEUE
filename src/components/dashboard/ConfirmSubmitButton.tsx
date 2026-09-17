'use client';

import React, { useState } from 'react';

/**
 * Phase 5A — two-tap confirmation for destructive dashboard state changes
 * (pause/close queue). First tap arms ("Sure?"), second submits the form.
 * No browser confirm() dialogs. Auto-disarms after a few seconds so a
 * stale armed button can never surprise-submit.
 */
export function ConfirmSubmitButton({
  idleLabel,
  armedLabel,
  className,
  disarmMs = 4000,
}: {
  idleLabel: React.ReactNode;
  armedLabel: React.ReactNode;
  className?: string;
  disarmMs?: number;
}) {
  const [armed, setArmed] = useState(false);

  return (
    <button
      type={armed ? 'submit' : 'button'}
      aria-live="polite"
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
          window.setTimeout(() => setArmed(false), disarmMs);
        }
      }}
      className={className}
    >
      {armed ? armedLabel : idleLabel}
    </button>
  );
}
