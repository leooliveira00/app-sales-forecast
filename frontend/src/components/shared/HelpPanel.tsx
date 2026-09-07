import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Search, X, BookOpen, ListChecks, PlayCircle, ChevronRight, FileText, Video, Loader2 } from 'lucide-react';
import { cn } from './Common';
import { useHelp } from '../../context/HelpContext';
import { useTour } from '../../context/TourContext';
import { useAuth } from '../../hooks/useAuth';

interface GlossaryEntry { term: string; def: string }
interface GuideEntry { id: string; title: string; steps: string[] }
interface VideoEntry { slug: string; title: string }

type Tab = 'guides' | 'glossary' | 'videos';

export const HelpPanel: React.FC = () => {
  const { t } = useTranslation('help');
  const { isOpen, initialTab, closeHelp } = useHelp();
  const { steps: tourSteps, startTour } = useTour();
  const { user, token, activeUnidade } = useAuth();
  // Vídeos existem só em português → liberados para unidades nacionais;
  // unidades de exportação (com países) veem "em breve".
  const isExportUnit = (activeUnidade?.unidadeVenda?.paises?.length ?? 0) > 0;

  const [tab, setTab]     = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');

  // Player de vídeo: vídeo em reprodução + URL com ticket assinado.
  const [playing,   setPlaying]   = useState<VideoEntry | null>(null);
  const [videoUrl,  setVideoUrl]  = useState<string | null>(null);
  const [videoError, setVideoError] = useState(false);

  // Sincroniza aba/busca ao (re)abrir
  useEffect(() => {
    if (isOpen) { setTab(initialTab); setQuery(''); setPlaying(null); }
  }, [isOpen, initialTab]);

  // Fecha no Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeHelp(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, closeHelp]);

  const glossary = useMemo(
    () => (t('glossary', { returnObjects: true, defaultValue: [] }) as GlossaryEntry[]),
    [t],
  );
  const guides = useMemo(
    () => (t(`guides.${user?.perfil ?? ''}`, { returnObjects: true, defaultValue: [] }) as GuideEntry[]),
    [t, user?.perfil],
  );
  const videos = useMemo(
    () => (t('videos', { returnObjects: true, defaultValue: [] }) as VideoEntry[]),
    [t],
  );

  const q = query.trim().toLowerCase();
  const filteredGlossary = useMemo(
    () => !q ? glossary : glossary.filter(g =>
      g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q)),
    [glossary, q],
  );
  const filteredGuides = useMemo(
    () => !q ? guides : guides.filter(g =>
      g.title.toLowerCase().includes(q) || g.steps.some(s => s.toLowerCase().includes(q))),
    [guides, q],
  );
  const filteredVideos = useMemo(
    () => !q ? videos : videos.filter(v => v.title.toLowerCase().includes(q)),
    [videos, q],
  );

  const [openGuide, setOpenGuide] = useState<string | null>(null);

  // Unidade de exportação → manual sempre em inglês (público estrangeiro),
  // independente do idioma da interface. Nacional → segue o idioma da UI.
  const manualUrl = isExportUnit
    ? '/uploads/manuais/manual-en.pdf'
    : t('manualUrl', { defaultValue: '' });

  // Busca o ticket assinado e monta a URL autenticada do vídeo selecionado.
  useEffect(() => {
    if (!playing || !token) { setVideoUrl(null); return; }
    let cancelled = false;
    setVideoUrl(null);
    setVideoError(false);
    fetch(`/api/treinamentos/${playing.slug}/ticket`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ token: ticket }: { token: string }) => {
        if (!cancelled) setVideoUrl(`/api/treinamentos/${playing.slug}?ticket=${encodeURIComponent(ticket)}`);
      })
      .catch(() => { if (!cancelled) setVideoError(true); });
    return () => { cancelled = true; };
  }, [playing, token]);

  if (!isOpen) return null;

  const showTourButton = tourSteps.length > 0;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in"
        onClick={closeHelp}
      />

      {/* Painel */}
      <aside
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        {/* Cabeçalho */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 leading-tight">{t('title')}</h2>
              <p className="text-xs text-slate-400 leading-tight mt-0.5">{t('subtitle')}</p>
            </div>
          </div>
          <button
            onClick={closeHelp}
            className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg hover:bg-slate-50 transition-colors"
            aria-label={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Busca */}
        <div className="px-5 pt-3 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-400"
            />
          </div>
        </div>

        {/* Abas */}
        <div className="px-5 pt-3 shrink-0">
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setTab('guides')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors',
                tab === 'guides' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <ListChecks className="w-3.5 h-3.5" /> {t('tabs.guides')}
            </button>
            <button
              onClick={() => setTab('glossary')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors',
                tab === 'glossary' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <BookOpen className="w-3.5 h-3.5" /> {t('tabs.glossary')}
            </button>
            <button
              onClick={() => setTab('videos')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors',
                tab === 'videos' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Video className="w-3.5 h-3.5" /> {t('tabs.videos')}
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'guides' ? (
            filteredGuides.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">
                {q ? t('noResults', { query }) : t('guidesEmpty')}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredGuides.map(g => {
                  const expanded = openGuide === g.id || !!q;
                  return (
                    <div key={g.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        onClick={() => setOpenGuide(prev => prev === g.id ? null : g.id)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        <ChevronRight className={cn('w-4 h-4 text-slate-400 shrink-0 transition-transform', expanded && 'rotate-90')} />
                        <span className="text-sm font-semibold text-slate-700 flex-1">{g.title}</span>
                      </button>
                      {expanded && (
                        <ol className="px-4 pb-3 pt-1 space-y-1.5 list-decimal list-inside marker:text-sky-400 marker:font-bold">
                          {g.steps.map((s, i) => (
                            <li key={i} className="text-sm text-slate-600 leading-snug pl-1">{s}</li>
                          ))}
                        </ol>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : tab === 'glossary' ? (
            filteredGlossary.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">{t('noResults', { query })}</p>
            ) : (
              <dl className="space-y-3">
                {filteredGlossary.map(g => (
                  <div key={g.term} className="border-b border-slate-50 pb-3 last:border-0">
                    <dt className="text-sm font-bold text-slate-800">{g.term}</dt>
                    <dd className="text-sm text-slate-500 leading-snug mt-0.5">{g.def}</dd>
                  </div>
                ))}
              </dl>
            )
          ) : (
            isExportUnit ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                <span className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center">
                  <Video className="w-6 h-6" />
                </span>
                <p className="text-sm font-semibold text-slate-600">{t('videosComingSoon')}</p>
                <p className="text-xs text-slate-400 max-w-xs">{t('videosComingSoonHint')}</p>
              </div>
            ) : filteredVideos.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-10">
                {q ? t('noResults', { query }) : t('videosEmpty')}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredVideos.map(v => (
                  <button
                    key={v.slug}
                    onClick={() => setPlaying(v)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 hover:border-sky-200 transition-colors text-left"
                  >
                    <span className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                      <PlayCircle className="w-5 h-5" />
                    </span>
                    <span className="text-sm font-semibold text-slate-700 flex-1">{v.title}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {/* Rodapé: manual completo + refazer tour */}
        {(manualUrl || showTourButton) && (
          <div className="px-5 py-3 border-t border-slate-100 shrink-0 space-y-2">
            {manualUrl && (
              <a
                href={manualUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 py-2 rounded-xl transition-colors"
              >
                <FileText className="w-4 h-4" />
                {t('manual')}
              </a>
            )}
            {showTourButton && (
              <button
                onClick={() => { closeHelp(); startTour(); }}
                className="w-full flex items-center justify-center gap-2 text-sm font-bold text-sky-700 bg-sky-50 hover:bg-sky-100 py-2 rounded-xl transition-colors"
              >
                <PlayCircle className="w-4 h-4" />
                {t('redoTour')}
              </button>
            )}
          </div>
        )}
      </aside>

      {/* Player de vídeo (overlay sobre o painel) */}
      {playing && (
        <div
          className="absolute inset-0 z-[310] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPlaying(null)}
        >
          <div
            className="relative w-full max-w-3xl bg-slate-900 rounded-2xl overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800">
              <span className="text-sm font-semibold text-white truncate">{playing.title}</span>
              <button
                onClick={() => setPlaying(null)}
                className="p-1 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                aria-label={t('close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center">
              {videoError ? (
                <p className="text-sm text-slate-300 px-6 text-center">{t('videoLoadError')}</p>
              ) : videoUrl ? (
                <video
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full"
                  onError={() => setVideoError(true)}
                />
              ) : (
                <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};
