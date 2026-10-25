import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="empty-state fade-in">
      <Icon size={40} strokeWidth={1.5} aria-hidden />
      <p className="title">{title}</p>
      {hint && <p>{hint}</p>}
    </div>
  );
}
