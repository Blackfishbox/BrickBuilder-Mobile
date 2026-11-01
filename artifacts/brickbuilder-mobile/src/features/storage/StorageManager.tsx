import { useCallback, useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Database, Download, HardDrive, LoaderCircle, Lock, Package, RefreshCw, Shapes, Trash2, X } from 'lucide-react';
import {
  getStorageOverview,
  removeGeometrySnapshot,
  removeInstalledPackage,
  removeStoredProject,
  type StorageEntry,
  type StorageOverview,
} from '@/storage/management';
import { loadProject } from '@/storage/database';
import { exportModel } from '@/features/formats/adapters';
import './storage-manager.css';

interface Props {
  currentProjectId: string;
  onClose: () => void;
  onProjectsChanged: () => Promise<unknown>;
}

type Pending = { kind: 'project' | 'package'; entry: StorageEntry } | null;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unbekannt';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const sum = (list: StorageEntry[]) => list.reduce((total, item) => total + item.bytes, 0);
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export default function StorageManager({ currentProjectId, onClose, onProjectsChanged }: Props) {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [confirmError, setConfirmError] = useState('');
  const alive = useRef(true);
  const lock = useRef(false);
  const loadToken = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true); setLoadError('');
    try {
      const next = await getStorageOverview();
      if (alive.current && token === loadToken.current) setOverview(next);
    } catch (error) {
      if (alive.current && token === loadToken.current) setLoadError(message(error, 'Speicherübersicht konnte nicht geladen werden.'));
    } finally {
      if (alive.current && token === loadToken.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportProject = async (entry: StorageEntry) => {
    if (exportingId) return;
    setExportingId(entry.id); setActionError(''); setConfirmError('');
    try {
      const document = await loadProject(entry.id);
      if (!document) throw new Error('Projekt wurde nicht gefunden.');
      const { bytes, filename, mime } = await exportModel(document, 'json');
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const anchor = window.document.createElement('a');
      anchor.href = url; anchor.download = filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (alive.current) setNotice(`Sicherung „${filename}“ wurde zum Herunterladen bereitgestellt. Bitte prüfe die Datei.`);
    } catch (error) {
      const text = message(error, 'Export fehlgeschlagen.');
      if (alive.current) { if (pending) setConfirmError(text); else setActionError(text); }
    } finally {
      if (alive.current) setExportingId(null);
    }
  };

  const run = async (id: string, task: () => Promise<void>, done: string, inDialog: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusyId(id); setActionError(''); setConfirmError(''); setNotice('');
    try {
      await task();
      if (!alive.current) return;
      setPending(null);
      setNotice(done);
      await refresh();
    } catch (error) {
      const text = message(error, 'Aktion fehlgeschlagen.');
      if (alive.current) { if (inDialog) setConfirmError(text); else setActionError(text); }
    } finally {
      lock.current = false;
      if (alive.current) setBusyId(null);
    }
  };

  const confirmPending = () => {
    if (!pending) return;
    const { kind, entry } = pending;
    if (kind === 'project') {
      void run(entry.id, async () => {
        await removeStoredProject(entry.id, currentProjectId);
        await onProjectsChanged().catch(() => undefined);
      }, `Projekt „${entry.name}“ wurde gelöscht.`, true);
    } else {
      void run(entry.id, () => removeInstalledPackage(entry.id), `Paket „${entry.name}“ wurde entfernt.`, true);
    }
  };

  const removeSnapshot = (entry: StorageEntry) =>
    void run(entry.id, () => removeGeometrySnapshot(entry.id), `Geometrie-Snapshot „${entry.name}“ wurde entfernt.`, false);

  const busy = busyId !== null || exportingId !== null;
  const browser = overview?.browser;
  const hasUsage = typeof browser?.usage === 'number' && Number.isFinite(browser.usage);
  const hasQuota = typeof browser?.quota === 'number' && Number.isFinite(browser.quota) && browser.quota > 0;
  const ratio = hasUsage && hasQuota ? Math.min(1, browser!.usage! / browser!.quota!) : null;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <div className="drawer-scrim sm-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <Dialog.Content asChild aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}>
      <section className="parts-drawer sm-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="sm-title" data-testid="dialog-storage">
        <div className="drawer-handle" />
        <div className="drawer-heading">
          <div><p className="popover-eyebrow">OFFLINE-SPEICHER</p><Dialog.Title asChild><h2 id="sm-title">Speicher verwalten</h2></Dialog.Title></div>
          <div className="sm-head-actions">
            <button type="button" className="icon-button" onClick={() => void refresh()} disabled={loading || busy} aria-label="Übersicht aktualisieren" data-testid="button-refresh-storage">
              <RefreshCw size={17} className={loading ? 'spin' : undefined} />
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Speicherverwaltung schließen" data-testid="button-close-storage"><X size={18} /></button>
          </div>
        </div>

        <div className="sm-gauge" data-testid="status-browser-storage">
          <div className="sm-gauge-top">
            <HardDrive size={17} />
            <div>
              <strong>Browser-Speicher dieser Website</strong>
              {loading && !overview ? <span className="sm-skel sm-skel-line" /> : hasUsage ? (
                <span data-testid="text-browser-usage">{formatBytes(browser!.usage!)} belegt{hasQuota ? ` von ca. ${formatBytes(browser!.quota!)}` : ''}</span>
              ) : (
                <span data-testid="text-browser-usage-unavailable">Schätzung nicht verfügbar{browser?.error ? ` (${browser.error})` : ''}</span>
              )}
            </div>
          </div>
          {ratio !== null && <div className="sm-bar" role="progressbar" aria-label="Belegter Browser-Speicher" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}><i style={{ transform: `scaleX(${Math.max(ratio, 0.01)})` }} /></div>}
          <p>Die Browser-Angabe umfasst alle Daten dieser Herkunft (z. B. App-Cache und Datenbank-Verwaltung). Die Kategorien unten sind Schätzungen der gespeicherten JSON-Daten (UTF-8) und ergeben zusammen nicht diese Summe.</p>
        </div>

        <div className="sm-warning" role="note">
          <AlertTriangle size={16} />
          <p>Eine JSON-Sicherung enthält die Original-Uploads, Ressourcen, Herkunftsangaben und Lizenztexte des Projekts. Beim Löschen eines Projekts werden auch seine lokal gespeicherten Original-Uploads endgültig entfernt. Prüfe deine Sicherung, bevor du löschst.</p>
        </div>

        {notice && <div className="sm-notice" role="status" data-testid="status-storage-notice">{notice}</div>}
        {actionError && <div className="fmt-error sm-error" role="alert" data-testid="status-storage-error">{actionError}</div>}

        {loadError && !loading ? (
          <div className="sm-state" role="alert" data-testid="status-storage-load-error">
            <AlertTriangle size={20} /><strong>Übersicht nicht verfügbar</strong><span>{loadError}</span>
            <button type="button" className="cancel-button sm-btn" onClick={() => void refresh()} data-testid="button-retry-storage">Erneut versuchen</button>
          </div>
        ) : loading && !overview ? (
          <div className="sm-loading" aria-busy="true" data-testid="status-storage-loading">
            {[0, 1, 2].map((n) => <div key={n} className="sm-skel sm-skel-row" />)}
            <span className="sr-only">Speicherübersicht wird geladen</span>
          </div>
        ) : overview && (
          <>
            <Group index="01" icon={<Database size={15} />} title="Projekte" entries={overview.projects} empty="Keine Projekte auf diesem Gerät gespeichert.">
              {(entry) => {
                const active = entry.id === currentProjectId;
                return (
                  <>
                    <button type="button" className="sm-btn sm-ghost" onClick={() => void exportProject(entry)} disabled={exportingId !== null} data-testid={`button-export-project-${entry.id}`}>
                      {exportingId === entry.id ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} Sichern (JSON)
                    </button>
                    {active ? (
                      <span className="sm-active" data-testid={`status-active-project-${entry.id}`}><Lock size={13} /> Geöffnet – zum Löschen erst ein anderes Projekt öffnen</span>
                    ) : (
                      <button type="button" className="sm-btn sm-danger" onClick={() => { setConfirmError(''); setPending({ kind: 'project', entry }); }} disabled={busy} data-testid={`button-delete-project-${entry.id}`}>
                        <Trash2 size={14} /> Löschen
                      </button>
                    )}
                  </>
                );
              }}
            </Group>
            <Group index="02" icon={<Package size={15} />} title="Installierte Bibliothekspakete" entries={overview.packages} empty="Keine Bibliothekspakete installiert.">
              {(entry) => (
                <button type="button" className="sm-btn sm-danger" onClick={() => { setConfirmError(''); setPending({ kind: 'package', entry }); }} disabled={busy} data-testid={`button-remove-package-${entry.id}`}>
                  <Trash2 size={14} /> Entfernen
                </button>
              )}
            </Group>
            <Group index="03" icon={<Shapes size={15} />} title="Wiederverwendbare Geometrie-Snapshots" entries={overview.snapshots} empty="Keine Geometrie-Snapshots gespeichert." note="Snapshots beschleunigen erneute Importe. Entfernte Snapshots werden bei Bedarf neu geladen.">
              {(entry) => (
                <button type="button" className="sm-btn sm-ghost" onClick={() => removeSnapshot(entry)} disabled={busy} data-testid={`button-remove-snapshot-${entry.id}`}>
                  {busyId === entry.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />} Entfernen
                </button>
              )}
            </Group>
          </>
        )}
      </section>
      </Dialog.Content>

      <AlertDialog.Root open={pending !== null} onOpenChange={(open) => { if (!open && !busy) setPending(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="sm-overlay" />
          <AlertDialog.Content className="confirm-card sm-confirm" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} data-testid="dialog-confirm-storage">
            <div className="confirm-icon"><Trash2 size={20} /></div>
            <AlertDialog.Title asChild>
              <h2>{pending?.kind === 'project' ? 'Projekt endgültig löschen?' : 'Paket entfernen?'}</h2>
            </AlertDialog.Title>
            <AlertDialog.Description asChild>
              {pending?.kind === 'project' ? (
                <div className="sm-confirm-copy">
                  <p><b>„{pending.entry.name}“</b> ({formatBytes(pending.entry.bytes)}) wird mitsamt seinen lokal gespeicherten Original-Uploads dauerhaft von diesem Gerät entfernt. Dies kann nicht rückgängig gemacht werden.</p>
                  <p>Exportiere zuerst eine JSON-Sicherung und prüfe sie. Der Export löscht nichts.</p>
                </div>
              ) : (
                <div className="sm-confirm-copy">
                  <p><b>„{pending?.entry.name}“</b> ist danach nicht mehr in der Bibliothek verfügbar, bis du es ausdrücklich erneut installierst.</p>
                  <p>Gespeicherte Projekte behalten ihre eingebetteten Ressourcen.</p>
                </div>
              )}
            </AlertDialog.Description>
            {pending?.kind === 'project' && (
              <button type="button" className="sm-btn sm-ghost sm-wide" onClick={() => void exportProject(pending.entry)} disabled={exportingId !== null || busy} data-testid="button-confirm-export-project">
                {exportingId ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} JSON-Sicherung herunterladen
              </button>
            )}
            {confirmError && <div className="fmt-error sm-error" role="alert" data-testid="status-confirm-error">{confirmError}</div>}
            <div className="confirm-actions">
              <AlertDialog.Cancel asChild>
                <button type="button" className="cancel-button" disabled={busy} data-testid="button-cancel-storage-action">Abbrechen</button>
              </AlertDialog.Cancel>
              <button type="button" className="confirm-button sm-confirm-go" onClick={confirmPending} disabled={busy} data-testid="button-confirm-storage-action">
                {busy ? <><LoaderCircle className="spin" size={14} /> Wird ausgeführt</> : pending?.kind === 'project' ? 'Endgültig löschen' : 'Paket entfernen'}
              </button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
    </Dialog.Root>
  );
}

function Group({ index, icon, title, entries, empty, note, children }: {
  index: string; icon: React.ReactNode; title: string; entries: StorageEntry[]; empty: string; note?: string;
  children: (entry: StorageEntry) => React.ReactNode;
}) {
  return (
    <section className="sm-group" aria-labelledby={`sm-group-${index}`}>
      <h3 id={`sm-group-${index}`}><span>{index}</span>{icon}{title}<em data-testid={`text-storage-total-${index}`}>ca. {formatBytes(sum(entries))}</em></h3>
      {note && <p className="sm-note">{note}</p>}
      {entries.length ? (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className="sm-row" data-testid={`row-storage-${entry.id}`}>
              <div className="sm-row-copy"><strong>{entry.name || 'Ohne Namen'}</strong><small>{entry.detail}</small></div>
              <span className="sm-size">ca. {formatBytes(entry.bytes)}</span>
              <div className="sm-row-actions">{children(entry)}</div>
            </li>
          ))}
        </ul>
      ) : <div className="sm-empty">{empty}</div>}
    </section>
  );
}
