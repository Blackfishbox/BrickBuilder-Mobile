import { useId, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { ImportedModel } from './types';
import { getImportPartFailures } from './import-failures';
import './import-part-notification.css';

interface Props {
  model?: ImportedModel;
  dismissible?: boolean;
  floating?: boolean;
}

export default function ImportPartNotification({ model, dismissible = true, floating = false }: Props) {
  const titleId = useId();
  const failures = useMemo(() => getImportPartFailures(model), [model]);
  const signature = JSON.stringify(failures);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!failures.length || (dismissible && dismissed === signature)) return null;
  const count = failures.reduce((sum, part) => sum + part.count, 0);

  return (
    <aside
      className={`import-part-notification${floating ? ' import-part-notification-floating' : ''}`}
      role="alert"
      aria-labelledby={titleId}
      data-testid="notification-import-parts"
    >
      <div className="import-part-notification-heading">
        <AlertTriangle size={20} aria-hidden="true" />
        <strong id={titleId}>Import unvollständig</strong>
        {dismissible && (
          <button type="button" onClick={() => setDismissed(signature)} aria-label="Importbenachrichtigung schließen">
            <X size={19} aria-hidden="true" />
          </button>
        )}
      </div>
      <p>Nicht darstellbar: {count} {count === 1 ? 'Instanz' : 'Instanzen'} · {failures.length} {failures.length === 1 ? 'Teilenummer' : 'Teilenummern'}</p>
      <ul aria-label="Nicht importierbare Teile" tabIndex={0}>
        {failures.map(part => (
          <li key={part.reference.toLowerCase()}>
            <strong>LDraw {part.ldrawId} · {part.count}×</strong>
            {part.brickLinkIds.length > 0 && <span>BrickLink {part.brickLinkIds.join(', ')}</span>}
            {part.reasons.map(reason => <span key={reason}>{reason}</span>)}
          </li>
        ))}
      </ul>
      <small>Quelldaten bleiben erhalten. Es werden keine Ersatzsteine eingesetzt.</small>
    </aside>
  );
}
