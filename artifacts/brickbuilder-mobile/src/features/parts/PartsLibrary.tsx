import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CloudOff, Download, ExternalLink, LoaderCircle, Plus, RotateCw, Search, X } from 'lucide-react';
import { PART_PACKAGES, installPackage, listInstalledPackages, searchLocalParts } from './library';
import type { InstalledPackage, LibraryPart } from './types';
import './parts-library.css';
import CatalogPanel from "../catalog/CatalogPanel";

type PkgState = { status: 'idle' | 'pending' | 'error'; error?: string };
type Category = '' | 'Steine' | 'Platten';

const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`;

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

interface Props {
  online: boolean;
  selectedPartId?: string;
  loading?: boolean;
  onSelect: (part: LibraryPart) => void;
}

export default function PartsLibrary({ online, selectedPartId, loading = false, onSelect }: Props) {
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const [installed, setInstalled] = useState<InstalledPackage[] | null>(null);
  const [installedError, setInstalledError] = useState('');
  const [pkgState, setPkgState] = useState<Record<string, PkgState>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('');
  const [results, setResults] = useState<LibraryPart[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchNonce, setSearchNonce] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    controllerRef.current = new AbortController();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const loadInstalled = useCallback(async () => {
    setInstalledError('');
    try {
      const list = await listInstalledPackages();
      if (mountedRef.current) setInstalled(list);
    } catch (error) {
      if (mountedRef.current) {
        setInstalled([]);
        setInstalledError(errorText(error, 'Installierte Pakete konnten nicht gelesen werden.'));
      }
    }
  }, []);

  useEffect(() => { void loadInstalled(); }, [loadInstalled]);

  useEffect(() => {
    let active = true;
    setResults(null);
    setSearchError('');
    const timer = window.setTimeout(() => {
      searchLocalParts(query, category)
        .then((parts) => { if (active && mountedRef.current) setResults(parts); })
        .catch((error: unknown) => {
          if (active && mountedRef.current) {
            setResults([]);
            setSearchError(errorText(error, 'Lokale Suche fehlgeschlagen.'));
          }
        });
    }, 160);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, category, searchNonce, installed]);

  const install = async (id: string) => {
    const signal = controllerRef.current?.signal;
    if (!signal || signal.aborted) return;
    setPkgState((s) => ({ ...s, [id]: { status: 'pending' } }));
    try {
      await installPackage(id, signal);
      if (!mountedRef.current) return;
      setPkgState((s) => ({ ...s, [id]: { status: 'idle' } }));
      await loadInstalled();
    } catch (error) {
      if (!mountedRef.current || signal.aborted) return;
      setPkgState((s) => ({ ...s, [id]: { status: 'error', error: errorText(error, 'Installation fehlgeschlagen.') } }));
    }
  };

  const installedMap = new Map((installed ?? []).map((p) => [p.id, p]));
  const hasInstalled = installedMap.size > 0;

  return (
    <section className="plib" aria-labelledby="plib-title" data-testid="parts-library">
      <div className="plib-head">
        <div>
          <p className="popover-eyebrow">LDRAW-BIBLIOTHEK</p>
          <h3 id="plib-title">Lokale Teilepakete</h3>
        </div>
        {!online && (
          <span className="plib-offline" role="status" data-testid="status-library-offline">
            <CloudOff size={13} /> Offline · nur installierte Teile
          </span>
        )}
      </div>

      <CatalogPanel />
      {installedError && (
        <div className="plib-alert" role="alert">
          <AlertTriangle size={14} /><span>{installedError}</span>
          <button type="button" onClick={() => void loadInstalled()} data-testid="button-retry-installed">Erneut</button>
        </div>
      )}

      <ul className="plib-packages">
        {PART_PACKAGES.map((pkg) => {
          const state = pkgState[pkg.id]?.status ?? 'idle';
          const inst = installedMap.get(pkg.id);
          const current = inst?.version === pkg.version;
          return (
            <li key={pkg.id} className={`plib-pkg ${inst ? 'is-installed' : ''}`} data-testid={`package-${pkg.id}`}>
              <div className="plib-pkg-row">
                <div className="plib-pkg-copy">
                  <strong>{pkg.title}</strong>
                  <small>{pkg.description}</small>
                  <span className="plib-meta">
                    v{pkg.version} · {formatBytes(pkg.bytes)} · {pkg.partCount} Teile · {pkg.fileCount} Dateien
                  </span>
                </div>
                {installed === null ? (
                  <span className="plib-skel" aria-label="Status wird geladen" />
                ) : state === 'pending' ? (
                  <span className="plib-btn is-pending" role="status" data-testid={`status-pending-${pkg.id}`}>
                    <LoaderCircle size={14} className="spin" /> Lädt
                  </span>
                ) : inst && current ? (
                  <span className="plib-installed" data-testid={`status-installed-${pkg.id}`}><Check size={14} /> Installiert</span>
                ) : (
                  <button
                    type="button"
                    className="plib-btn"
                    onClick={() => void install(pkg.id)}
                    disabled={!online}
                    aria-label={`${pkg.title} ${state === 'error' ? 'erneut ' : ''}herunterladen`}
                    data-testid={`button-install-${pkg.id}`}
                  >
                    {state === 'error' ? <RotateCw size={14} /> : <Download size={14} />}
                    {state === 'error' ? 'Wiederholen' : inst ? 'Aktualisieren' : 'Laden'}
                  </button>
                )}
              </div>
              {state === 'error' && (
                <p className="plib-error" role="alert" data-testid={`error-${pkg.id}`}>
                  <AlertTriangle size={13} /> {pkgState[pkg.id]?.error}
                </p>
              )}
              {inst && (
                <p className="plib-installed-at">
                  Installiert am {new Date(inst.installedAt).toLocaleDateString('de-DE')}
                  {!current && ` · Version ${inst.version}, neu verfügbar: ${pkg.version}`}
                </p>
              )}
              <details className="plib-details">
                <summary>Herkunft und Lizenz</summary>
                <dl>
                  <dt>Urheber</dt><dd>{pkg.attribution}</dd>
                  <dt>Lizenz</dt><dd>{pkg.licenses.join(', ')}</dd>
                  <dt>Änderungen</dt><dd>{pkg.changes}</dd>
                </dl>
                <div className="plib-links">
                  <a href={pkg.sourceUrl} target="_blank" rel="noreferrer noopener">Quelle: LDraw-Bibliothek <ExternalLink size={11} /></a>
                  <a href={pkg.licenseUrl} target="_blank" rel="noreferrer noopener">Lizenztext <ExternalLink size={11} /></a>
                </div>
                {inst?.legalDocuments?.length ? (
                  <div className="plib-legal" aria-label="Lokal gespeicherte Lizenzdokumente">
                    {inst.legalDocuments.map((doc) => (
                      <details key={doc.name} className="plib-doc" data-testid={`legal-${pkg.id}-${doc.name}`}>
                        <summary>{doc.name} <span>offline lesbar</span></summary>
                        <pre tabIndex={0} aria-label={doc.name}>{doc.content}</pre>
                        <a href={doc.sourceUrl} target="_blank" rel="noreferrer noopener">Originalquelle <ExternalLink size={11} /></a>
                      </details>
                    ))}
                  </div>
                ) : inst ? null : (
                  <p className="plib-installed-at">Lizenzdokumente werden mit dem Paket lokal gespeichert.</p>
                )}
              </details>
            </li>
          );
        })}
      </ul>

      <div className="plib-search-row">
        <label className="search-field plib-search">
          <Search size={16} />
          <input
            type="search"
            placeholder="Name, LDraw-Nummer oder Kategorie"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Lokale LDraw-Teile durchsuchen"
            data-testid="input-search-library"
          />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche leeren"><X size={14} /></button>}
        </label>
        <div className="plib-filter" role="group" aria-label="Kategorie">
          {(['', 'Steine', 'Platten'] as Category[]).map((c) => (
            <button
              key={c || 'alle'}
              type="button"
              className={category === c ? 'active' : ''}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              data-testid={`button-category-${c || 'alle'}`}
            >{c || 'Alle'}</button>
          ))}
        </div>
      </div>

      <div className="plib-results" aria-live="polite" aria-busy={results === null}>
        {searchError ? (
          <div className="plib-alert" role="alert">
            <AlertTriangle size={14} /><span>{searchError}</span>
            <button type="button" onClick={() => setSearchNonce((n) => n + 1)} data-testid="button-retry-search">Erneut</button>
          </div>
        ) : results === null ? (
          [0, 1, 2].map((i) => <div key={i} className="plib-row-skel" />)
        ) : results.length === 0 ? (
          <div className="drawer-empty" data-testid="status-library-empty">
            <Search size={19} />
            <strong>{hasInstalled ? 'Keine passenden Teile' : 'Noch keine Pakete installiert'}</strong>
            <span>{hasInstalled ? 'Suche nach Name oder LDraw-Nummer, z. B. 3001.' : 'Lade oben ein Paket, um es offline zu durchsuchen.'}</span>
          </div>
        ) : results.map((part) => {
          const body = (
            <>
              <span className="plib-id">LDraw<br /><b>{part.ldrawId}</b></span>
              <span className="drawer-piece-copy">
                <strong>{part.name}</strong>
                <small>{part.category} · Geometrie wird vor dem Platzieren geprüft</small>
              </span>
            </>
          );
          return (
            <button
              key={part.id}
              type="button"
              className={`drawer-piece plib-part ${selectedPartId === part.ldrawId ? 'chosen' : ''}`}
              disabled={loading}
              onClick={() => onSelect(part)}
              aria-label={`${part.name}, LDraw ${part.ldrawId}, auswählen`}
              data-testid={`button-library-part-${part.ldrawId}`}
            >
              {body}
              {selectedPartId === part.ldrawId ? <Check size={17} className="chosen-check" /> : <Plus size={17} className="add-glyph" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}
