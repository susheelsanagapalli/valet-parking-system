import { Star } from 'lucide-react';
import { useState } from 'react';

/** Stars fill up to the one under the pointer, and stay filled up to the one tapped. */
export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="star-input" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= shown ? 'on' : ''}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
        >
          <Star size={36} />
        </button>
      ))}
    </div>
  );
}

export function StarsShown({ value }: { value: number }) {
  return (
    <span className="stars-shown" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={22} className={n <= value ? 'on' : 'off'} />
      ))}
    </span>
  );
}
