import React, { useState } from 'react';
import {
  CheckCircle2, XCircle, Building, User,
  CalendarDays, AlertCircle, ChevronDown, ChevronUp, BarChart2, Globe,
} from 'lucide-react';
import { cn } from '../shared/Common';
import { ConfirmModal } from '../shared/ConfirmModal';
import { RejectModal } from './RejectModal';
import { SubmissionPreviewPanel } from './SubmissionPreviewPanel';
import { useConsolidadoCache } from '../../context/ConsolidadoCacheContext';
import { useAuth } from '../../hooks/useAuth';

// ── Tipos exportados para uso na página ───────────────────────────────────────

export interface Submission {
  id: string;
  refMonth: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  autoSubmitted: boolean;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  unidadeVenda: { id: string; codigo: string; descricao: string; tipo: string };
  autor: { id: string; nome: string; email: string };
  revisor: { id: string; nome: string } | null;
}

export const statusConfig = {
  DRAFT:     { label: 'Rascunho',  cls: 'bg-slate-100  text-slate-500  border-slate-200'  },
  SUBMITTED: { label: 'Pendente',  cls: 'bg-amber-50   text-amber-700  border-amber-200'  },
  APPROVED:  { label: 'Aprovado',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED:  { label: 'Rejeitado', cls: 'bg-red-50     text-red-700    border-red-200'    },
};

export const monthLabel = (iso: string) => {
  const d = new Date(iso);
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${meses[d.getUTCMonth()]} / ${d.getUTCFullYear()}`;
};

// ── Componente ────────────────────────────────────────────────────────────────

interface SubmissionCardProps {
  sub: Submission;
  token: string | null;
  onAction: () => void;
  showToast: (msg: string, type: 'success' | 'error') => void;
}

export const SubmissionCard: React.FC<SubmissionCardProps> = ({ sub, token, onAction, showToast }) => {
  const [approving,          setApproving]          = useState(false);
  const [showReject,         setShowReject]          = useState(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [expanded,           setExpanded]            = useState(false);
  const { invalidate } = useConsolidadoCache();
  const { user } = useAuth();
  const canViewAudit = ['operador_pcp', 'admin_ti'].includes(user?.perfil ?? '');
  /**
   * Decidir a submissão exige perfil de aprovação. O perfil `consulta` chega até
   * esta tela para acompanhar a fila, mas sem os botões — as rotas de approve e
   * reject já o recusam no backend; esconder aqui evita oferecer uma ação que
   * resultaria em 403.
   */
  const canDecide = ['operador_pcp', 'admin_ti'].includes(user?.perfil ?? '');

  const cfg = statusConfig[sub.status];

  /**
   * Autoria exibida.
   *
   * Em submissão automática o `autorId` gravado é apenas o usuário técnico que a
   * rotina usou (o primeiro admin_ti cadastrado, quando não havia DRAFT) ou o
   * gestor que deixou o rascunho — em nenhum dos casos alguém enviou de fato.
   * Exibir o nome dessa pessoa sugere uma ação que ela não praticou; a autoria
   * real está no AuditLog, com `source: "system"`.
   */
  const autorLabel = sub.autoSubmitted ? 'Submissão automática' : sub.autor.nome;

  const handleApprove = async () => {
    setShowApproveConfirm(false);
    setApproving(true);
    try {
      const res = await fetch(`/api/submissions/${sub.id}/approve`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) { invalidate(); showToast('Forecast aprovado!', 'success'); onAction(); }
      else { const e = await res.json(); showToast(e.error || 'Erro', 'error'); }
    } catch { showToast('Erro ao aprovar', 'error'); }
    finally { setApproving(false); }
  };

  return (
    <>
      {showApproveConfirm && (
        <ConfirmModal
          title="Aprovar Forecast"
          message={`Confirmar aprovação do forecast de ${monthLabel(sub.refMonth)} — ${sub.unidadeVenda.descricao}?`}
          confirmLabel="Aprovar"
          variant="primary"
          onConfirm={handleApprove}
          onCancel={() => setShowApproveConfirm(false)}
        />
      )}

      {showReject && (
        <RejectModal
          submissionId={sub.id}
          unidade={`${sub.unidadeVenda.codigo} — ${sub.unidadeVenda.descricao}`}
          month={monthLabel(sub.refMonth)}
          token={token}
          onClose={() => setShowReject(false)}
          onRejected={onAction}
          showToast={showToast}
        />
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header do card */}
        <div className="p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="p-2.5 bg-sky-50 text-sky-600 rounded-xl"><Building className="w-5 h-5" /></div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-slate-900">{sub.unidadeVenda.codigo}</span>
                <span className="text-slate-300">·</span>
                <span className="text-sm text-slate-500">{sub.unidadeVenda.descricao}</span>
                {sub.unidadeVenda.tipo === 'EXPORT' && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded text-[10px] font-bold uppercase">
                    <Globe className="w-3 h-3" /> Export
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <CalendarDays className="w-3 h-3" /> {monthLabel(sub.refMonth)}
                </span>
                <span className="flex items-center gap-1 text-xs text-slate-400">
                  <User className="w-3 h-3" /> {autorLabel}
                </span>
                {sub.submittedAt && (
                  <span className="text-xs text-slate-400">
                    Enviado em {new Date(sub.submittedAt).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            <span className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold border uppercase",
              cfg.cls
            )}>
              {cfg.label}
            </span>

            {sub.autoSubmitted && (
              <span
                title="Submetido automaticamente pelo sistema ao fim do prazo de envio"
                className="px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase bg-orange-50 text-orange-600 border-orange-200"
              >
                Automático
              </span>
            )}

            {sub.status === 'SUBMITTED' && canDecide && (
              <>
                <button
                  onClick={() => setShowReject(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <XCircle className="w-3.5 h-3.5" /> Rejeitar
                </button>
                <button
                  onClick={() => setShowApproveConfirm(true)}
                  disabled={approving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {approving ? 'Aprovando...' : 'Aprovar'}
                </button>
              </>
            )}

            {(sub.status === 'APPROVED' || sub.status === 'REJECTED') && sub.revisor && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <User className="w-3 h-3" />
                {sub.revisor.nome} em {sub.reviewedAt ? new Date(sub.reviewedAt).toLocaleDateString('pt-BR') : '—'}
              </span>
            )}

            <button onClick={() => setExpanded(e => !e)}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Detalhes expandidos */}
        {expanded && (
          <div className="border-t border-slate-100 px-6 py-4 bg-slate-50 space-y-3 text-sm">
            {sub.status === 'REJECTED' && sub.rejectionReason && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-xs">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span><strong>Motivo:</strong> {sub.rejectionReason}</span>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-lg p-3 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Status</p>
                <p className={cn("text-xs font-bold uppercase", cfg.cls.split(' ')[1])}>{cfg.label}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Autor</p>
                <p className="text-xs font-bold text-slate-700">{autorLabel}</p>
                <p className="text-[10px] text-slate-400">
                  {sub.autoSubmitted ? 'Sem envio manual até o fim do prazo' : sub.autor.email}
                </p>
              </div>
              {sub.revisor && (
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Revisor</p>
                  <p className="text-xs font-bold text-slate-700">{sub.revisor.nome}</p>
                </div>
              )}
              {sub.submittedAt && (
                <div className="bg-white rounded-lg p-3 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Submetido em</p>
                  <p className="text-xs font-bold text-slate-700">
                    {new Date(sub.submittedAt).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' })}
                  </p>
                </div>
              )}
            </div>

            {/* Prévia do forecast */}
            <div className="bg-white rounded-xl border border-slate-100 px-4 pb-4">
              <div className="flex items-center gap-2 py-3 border-b border-slate-50 mb-1">
                <BarChart2 className="w-3.5 h-3.5 text-sky-500" />
                <span className="text-xs font-bold text-slate-700">Prévia do Forecast</span>
                <span className="text-[10px] text-slate-400">— dados enviados pelo gestor</span>
                {canViewAudit && (
                  <a
                    href={`/admin/audit?refMonth=${sub.refMonth}&unidadeId=${sub.unidadeVenda.codigo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto text-xs text-sky-600 hover:underline"
                  >
                    Ver auditoria deste ciclo →
                  </a>
                )}
              </div>
              <SubmissionPreviewPanel submissionId={sub.id} unidadeVendaId={sub.unidadeVenda.codigo} token={token} />
            </div>
          </div>
        )}
      </div>
    </>
  );
};
