import { Car, Palette } from 'lucide-react';
import { useState } from 'react';
import type { LocationSettings } from '../types';

type Catalogue = LocationSettings['vehicleCatalogue'];
export interface VehicleValue {
  make: string;
  model: string;
  colour: string;
}

const OTHER = '__other__';

/**
 * A dropdown from the admin's list. With "Other" allowed, the last option opens a text field for a
 * value that isn't listed; without it, only listed values can be chosen.
 */
function Pick({
  label,
  icon,
  options,
  value,
  onChange,
  allowOther,
  disabled,
  placeholder,
}: {
  label: string;
  icon?: React.ReactNode;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  allowOther: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const listed = value === '' || options.includes(value);
  const [typing, setTyping] = useState(!listed);
  const other = allowOther && (typing || !listed);
  return (
    <label>
      <span className="label-text">
        {icon}
        {label}
      </span>
      <select
        // Without this, screen readers would read the chosen option as part of the name ("Make Choose make").
        aria-label={label}
        value={other ? OTHER : value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setTyping(next === OTHER);
          onChange(next === OTHER ? '' : next);
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {allowOther && <option value={OTHER}>Other…</option>}
      </select>
      {other && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={`Type the ${label.toLowerCase()}`} aria-label={`${label} (not in the list)`} maxLength={40} autoFocus />}
    </label>
  );
}

/** Make, model and colour picked from the location's vehicle list (Settings → Vehicle list). */
export function VehicleFields({ catalogue, value, onChange }: { catalogue: Catalogue; value: VehicleValue; onChange: (v: VehicleValue) => void }) {
  const make = catalogue.makes.find((m) => m.name === value.make);
  const makeTyped = value.make !== '' && !make;
  return (
    <>
      <Pick
        label="Make"
        icon={<Car size={16} aria-hidden />}
        options={catalogue.makes.map((m) => m.name)}
        value={value.make}
        // A new make clears the model, which belonged to the old one.
        onChange={(m) => onChange({ ...value, make: m, model: '' })}
        allowOther={catalogue.allowOther}
        placeholder="Choose make"
      />
      <Pick
        key={value.make || 'none'}
        label="Model"
        options={make?.models ?? []}
        value={value.model}
        onChange={(m) => onChange({ ...value, model: m })}
        allowOther={catalogue.allowOther}
        disabled={!value.make && !makeTyped}
        placeholder={value.make ? 'Choose model' : 'Choose the make first'}
      />
      <Pick
        label="Colour"
        icon={<Palette size={16} aria-hidden />}
        options={catalogue.colours}
        value={value.colour}
        onChange={(c) => onChange({ ...value, colour: c })}
        allowOther={catalogue.allowOther}
        placeholder="Choose colour"
      />
    </>
  );
}
