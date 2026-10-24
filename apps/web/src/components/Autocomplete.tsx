import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface Choice {
  id?: string;
  name: string;
}

export interface Option<M = unknown> {
  id: string;
  name: string;
  hint?: string;
  meta?: M;
}

interface Props<M> {
  id: string;
  /** Shown text. For single-value fields this is the current value's name. */
  text: string;
  onTextChange: (text: string) => void;
  /** Picking an existing option (with id) or confirming a new name (without). */
  onSelect: (choice: Choice, option?: Option<M>) => void;
  fetchOptions: (query: string) => Promise<Option<M>[]>;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
}

/** Accessible combobox (WAI-ARIA 1.2 list autocomplete) with an "Add 'X'" option for new values. */
export function Autocomplete<M>({ id, text, onTextChange, onSelect, fetchOptions, placeholder, invalid, describedBy, onBlur }: Props<M>) {
  const listId = useId();
  const [options, setOptions] = useState<Option<M>[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const request = useRef(0);
  const query = text.trim();

  useEffect(() => {
    if (!open) return;
    const n = ++request.current;
    const timer = setTimeout(() => {
      fetchOptions(query)
        .then((items) => {
          if (n === request.current) setOptions(items);
        })
        .catch(() => {
          if (n === request.current) setOptions([]);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, open, fetchOptions]);

  const exact = options.some((o) => o.name.toLowerCase() === query.toLowerCase());
  const showAdd = query.length > 0 && !exact;
  const rows: { key: string; label: string; hint?: string; pick: () => void }[] = [
    ...options.map((o) => ({ key: o.id, label: o.name, hint: o.hint, pick: () => onSelect({ id: o.id, name: o.name }, o) })),
    ...(showAdd ? [{ key: '__add', label: `Add “${query}”`, pick: () => onSelect({ name: query }) }] : []),
  ];

  const choose = (index: number) => {
    rows[index]?.pick();
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && open && rows.length > 0) {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  return (
    <div className="combobox">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open && rows.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 && rows[active] ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          onTextChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      {open && rows.length > 0 && (
        <ul id={listId} role="listbox" className="combobox-list">
          {rows.map((row, i) => (
            <li
              key={row.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
            >
              {row.label}
              {row.hint && <span className="muted"> · {row.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
