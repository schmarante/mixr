import { Fragment, type ReactNode } from 'react';

/**
 * Setzt React-Elemente (Links, Tasten, Code) für `{platzhalter}` in einen
 * übersetzten Text ein – Satzbau und Wortstellung bleiben so in der Sprachdatei.
 * Den Text dafür ohne Parameter übersetzen: t('ui.onboarding.tip').
 */
export function rich(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\{(\w+)\}/g).map((segment, i) =>
    i % 2 === 1 ? <Fragment key={i}>{segment in parts ? parts[segment] : `{${segment}}`}</Fragment> : segment,
  );
}
