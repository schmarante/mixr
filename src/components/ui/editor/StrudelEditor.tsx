import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Annotation, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { languageStore } from '../../../i18n';
import { activeLocations, codeErrorRange, projectSettings, type CodeRange } from '../../../store/agentBus';
import { cx } from '../lib/cx';
import { controlNameCompletionSource, strudelCompletionSource } from './completions';
import { errorField, highlightField, minimalChange, miniStrings, setErrorRange, setHighlights } from './decorations';
import { signatureHint } from './signatures';
import { strudelHighlighting, strudelTheme } from './theme';

/** Programmatische Text-Updates (nicht vom Nutzer) – lösen kein onChange aus. */
const External = Annotation.define<boolean>();

/** Wie lange eine Markierung nach dem Klingen sanft ausblendet. */
const FADE_MS = 320;

export interface StrudelEditorProps {
  value: string;
  /** Nur Nutzer-Eingaben (keine programmatischen Updates über `value`). */
  onChange?: (text: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Strg/⌘+Enter */
  onCommit?: () => void;
  /** Strg/⌘+. */
  onStop?: () => void;
  /**
   * panel   – großer Editor (Code-Panel): Zeilennummern, Suchen
   * compact – Code-Felder im Inspector (Code-Bausteine, Setup-Code)
   * line    – einzeilig (z. B. Parametername)
   */
  variant?: 'panel' | 'compact' | 'line';
  /** code = Strudel-Code (JS), controls = nur Control-Namen, none = aus */
  completion?: 'code' | 'controls' | 'none';
  /** Highlighter + Engine-Fehler anzeigen (nur der Code-Panel-Editor). */
  live?: boolean;
  /** Zusätzliche Fehlerstelle, gültig nur für genau den Text `forText`. */
  error?: ({ forText: string } & CodeRange) | null;
  ariaLabel: string;
  ariaDescribedBy?: string | undefined;
  id?: string;
  placeholder?: string | undefined;
  className?: string | undefined;
}

/**
 * Code-Editor auf Basis von CodeMirror 6 mit Strudel-Theme, Mini-Notation-Hervorhebung,
 * Autovervollständigung und (optional) Highlighter für die gerade klingenden Stellen.
 * Der Text gehört dem Aufrufer (`value`); Nutzer-Eingaben kommen über `onChange`.
 */
export default function StrudelEditor({
  value,
  onChange,
  onFocus,
  onBlur,
  onCommit,
  onStop,
  variant = 'compact',
  completion = 'code',
  live = false,
  error = null,
  ariaLabel,
  ariaDescribedBy,
  id,
  placeholder,
  className,
}: StrudelEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docText = useRef(value);
  const handlers = useRef({ onChange, onFocus, onBlur, onCommit, onStop });
  handlers.current = { onChange, onFocus, onBlur, onCommit, onStop };
  const errorRef = useRef(error);
  errorRef.current = error;

  // Editor einmalig aufbauen (Varianten-/Sprachwechsel bauen neu auf)
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const single = variant === 'line';
    const extensions: Extension[] = [
      strudelTheme,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              handlers.current.onCommit?.();
              return true;
            },
          },
          {
            key: 'Mod-.',
            run: () => {
              handlers.current.onStop?.();
              return true;
            },
          },
          ...(single
            ? [
                {
                  key: 'Enter',
                  run: (view: EditorView) => {
                    handlers.current.onCommit?.();
                    view.contentDOM.blur();
                    return true;
                  },
                },
              ]
            : []),
        ]),
      ),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EditorView.contentAttributes.of({
        'aria-label': ariaLabel,
        ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
        ...(id ? { id } : {}),
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
        translate: 'no',
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          docText.current = u.state.doc.toString();
          if (!u.transactions.some((tr) => tr.annotation(External))) handlers.current.onChange?.(docText.current);
        }
        if (u.focusChanged) {
          if (u.view.hasFocus) handlers.current.onFocus?.();
          else handlers.current.onBlur?.();
        }
      }),
      errorField,
    ];
    if (single) {
      extensions.push(EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)));
    } else {
      extensions.push(javascript(), strudelHighlighting, miniStrings, bracketMatching(), closeBrackets(), indentOnInput());
    }
    if (variant === 'panel') {
      extensions.push(lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), highlightSelectionMatches(), search({ top: true }));
    }
    if (live) extensions.push(highlightField);
    if (completion !== 'none') {
      const getLang = () => languageStore.get();
      const source =
        completion === 'controls'
          ? controlNameCompletionSource(getLang)
          : strudelCompletionSource(getLang, () => (projectSettings.get().samples ?? []).map((s) => s.name));
      extensions.push(autocompletion({ override: [source], activateOnTyping: true, icons: true, maxRenderedOptions: 60 }));
      // Tab übernimmt den markierten Vorschlag (sonst rückt Tab wie gewohnt ein)
      extensions.push(Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])));
      if (completion === 'code') extensions.push(signatureHint);
    }
    const keys = [...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap];
    if (variant === 'panel') keys.push(...searchKeymap);
    if (!single) keys.push(indentWithTab);
    extensions.push(keymap.of(keys));
    if (placeholder) extensions.push(placeholderExt(placeholder));

    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: docText.current, extensions }),
    });
    viewRef.current = view;
    return () => {
      if (view.hasFocus) handlers.current.onBlur?.();
      view.destroy();
      viewRef.current = null;
    };
    // ariaLabel/placeholder: Texte der aktuellen Sprache; Wechsel baut den Editor neu auf
  }, [variant, completion, live, ariaLabel, ariaDescribedBy, id, placeholder]);

  // Externe Text-Änderungen (Bausteine → Code, Undo …) minimal einspielen
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      docText.current = value;
      return;
    }
    const change = minimalChange(view.state.doc.toString(), value);
    if (!change) return;
    view.dispatch({
      changes: change,
      annotations: [External.of(true), Transaction.addToHistory.of(false)],
    });
  }, [value]);

  // Fehlerstelle: aus der Engine (für genau diesen Text) oder vom Aufrufer
  useEffect(() => {
    const apply = () => {
      const view = viewRef.current;
      if (!view) return;
      const text = docText.current;
      const own = errorRef.current;
      const engine = live ? codeErrorRange.get() : null;
      const range = own && own.forText === text ? own : engine && engine.code === text ? engine : null;
      view.dispatch({ effects: setErrorRange.of(range ? { start: range.start, end: range.end } : null) });
    };
    apply();
    const unsub = live ? codeErrorRange.listen(apply) : undefined;
    return () => unsub?.();
  }, [live, error, value]);

  // Highlighter: gerade klingende Stellen (nur wenn der gespielte Text dem Editor entspricht)
  useEffect(() => {
    if (!live) return;
    let prev = new Map<string, CodeRange>();
    const fading = new Map<string, CodeRange & { until: number }>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const render = (activeRanges: readonly CodeRange[]) => {
      const view = viewRef.current;
      if (!view) return;
      const now = performance.now();
      const next = new Map(activeRanges.map((r) => [`${r.start}:${r.end}`, r]));
      for (const [key, r] of prev) if (!next.has(key)) fading.set(key, { ...r, until: now + FADE_MS });
      for (const key of next.keys()) fading.delete(key);
      for (const [key, f] of fading) if (f.until <= now) fading.delete(key);
      prev = next;
      view.dispatch({ effects: setHighlights.of({ active: [...next.values()], fading: [...fading.values()] }) });
      if (timer) clearTimeout(timer);
      timer = null;
      if (fading.size > 0) {
        const soonest = Math.min(...[...fading.values()].map((f) => f.until));
        timer = setTimeout(() => render([...prev.values()]), Math.max(16, soonest - now + 5));
      }
    };
    const unsub = activeLocations.subscribe(({ code, ranges }) => {
      render(code !== '' && code === docText.current ? ranges : []);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [live]);

  return (
    <div
      ref={host}
      className={cx(
        'strudel-editor min-w-0',
        variant === 'panel' && 'h-full',
        variant === 'compact' &&
          'max-h-80 min-h-16 overflow-hidden rounded-xl border border-line-strong bg-canvas transition-colors hover:border-faint focus-within:border-accent [&_.cm-scroller]:max-h-80',
        variant === 'line' &&
          'rounded-xl border border-line-strong bg-canvas transition-colors hover:border-faint focus-within:border-accent [&_.cm-content]:py-1.5',
        className,
      )}
    />
  );
}
