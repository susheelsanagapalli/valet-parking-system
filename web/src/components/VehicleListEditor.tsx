import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { LocationSettings } from '../types';

type Catalogue = LocationSettings['vehicleCatalogue'];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sorted = (list: string[]) => [...list].sort((a, b) => a.localeCompare(b));
const modelCount = (n: number) => `${n} model${n === 1 ? '' : 's'}`;

/** Removable chips plus a field to add one more. */
function ChipList({ items, onChange, addLabel }: { items: string[]; onChange: (next: string[]) => void; addLabel: string }) {
  const [draft, setDraft] = useState('');
  const duplicate = draft.trim() !== '' && items.some((i) => same(i, draft));
  const add = () => {
    const value = draft.trim();
    if (!value || duplicate) return;
    onChange(sorted([...items, value]));
    setDraft('');
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="chips">
        {items.length === 0 && <span className="muted">None yet</span>}
        {items.map((i) => (
          <span className="chip" key={i}>
            {i}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== i))} aria-label={`Remove ${i}`}>
              <X size={14} aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the item instead of submitting the whole settings form.
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={addLabel}
          aria-label={addLabel}
          maxLength={40}
          style={{ flex: 1 }}
        />
        <button type="button" onClick={add} disabled={!draft.trim() || duplicate}>
          <Plus size={18} aria-hidden /> Add
        </button>
      </div>
      {duplicate && <span className="muted">Already in the list</span>}
    </div>
  );
}

/** Settings → Vehicle list: the makes, models and colours attendants choose from at check-in. */
export function VehicleListEditor({ value, onChange }: { value: Catalogue; onChange: (next: Catalogue) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [newMake, setNewMake] = useState('');
  const makeTaken = newMake.trim() !== '' && value.makes.some((m) => same(m.name, newMake));

  const addMake = () => {
    const name = newMake.trim();
    if (!name || makeTaken) return;
    onChange({ ...value, makes: [...value.makes, { name, models: [] }].sort((a, b) => a.name.localeCompare(b.name)) });
    setNewMake('');
    setOpen(name);
  };

  return (
    <div className="stack">
      <label className="check">
        <input type="checkbox" checked={value.allowOther} onChange={(e) => onChange({ ...value, allowOther: e.target.checked })} />
        Allow "Other…" so attendants can type a make, model or colour that isn't listed
      </label>

      <div className="stack" style={{ gap: 6 }}>
        <strong>Colours ({value.colours.length})</strong>
        <ChipList items={value.colours} onChange={(colours) => onChange({ ...value, colours })} addLabel="Add a colour" />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <strong>
          Makes and models ({value.makes.length} make{value.makes.length === 1 ? '' : 's'})
        </strong>
        <div className="list vehicle-makes">
          {value.makes.map((m) => {
            const expanded = open === m.name;
            return (
              <div key={m.name} className="list-row" style={{ flexWrap: 'wrap', minHeight: 56 }}>
                <button
                  type="button"
                  className="make-toggle"
                  onClick={() => setOpen(expanded ? null : m.name)}
                  aria-expanded={expanded}
                  aria-label={`${m.name}: ${modelCount(m.models.length)}`}
                >
                  {expanded ? <ChevronDown size={18} aria-hidden /> : <ChevronRight size={18} aria-hidden />}
                  <strong>{m.name}</strong>
                  <span className="muted">{modelCount(m.models.length)}</span>
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => onChange({ ...value, makes: value.makes.filter((x) => x !== m) })}
                  aria-label={`Remove make ${m.name}`}
                >
                  <Trash2 size={18} aria-hidden />
                </button>
                {expanded && (
                  <div style={{ width: '100%' }} className="fade-in">
                    <ChipList
                      items={m.models}
                      onChange={(models) => onChange({ ...value, makes: value.makes.map((x) => (x === m ? { ...x, models } : x)) })}
                      addLabel={`Add a ${m.name} model`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            value={newMake}
            onChange={(e) => setNewMake(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addMake();
              }
            }}
            placeholder="Add a make"
            aria-label="Add a make"
            maxLength={40}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={addMake} disabled={!newMake.trim() || makeTaken}>
            <Plus size={18} aria-hidden /> Add make
          </button>
        </div>
        {makeTaken && <span className="muted">Already in the list</span>}
      </div>
    </div>
  );
}
