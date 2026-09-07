import { useEffect, useMemo, useState } from 'react';
import {
  Download, XCircle, Loader2, Search, Layers, Package,
  AlertTriangle, Check, CalendarRange, Building2, FileSpreadsheet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../shared/Common';
import { Dropdown } from '../shared/Dropdown';

/**
 * Extração personalizada dos dados de forecast em CSV.
 *
 * Os números vêm do mesmo snapshot que alimenta o Consolidado, portanto o FCTS
 * do futuro só aparece para ciclos aprovados — extração e tela sempre contam a
 * mesma história.
 */

const METRICAS = ['orc', 'fcts', 'vendas', 'desvioFctsOrc', 'desvioVendasFcts'] as const;
type Metrica = (typeof METRICAS)[number];

type Nivel = 'produto' | 'familia';

type FiltrosDisponiveis = {
  unidades: Array<{ codigo: string; descricao: string }>;
  familias: string[];
  produtos: Array<{ codigo: string; descricao: string; familia: string }>;
  periodo:  { min: string; max: string } | null;   // "YYYY-MM" — intervalo com dados
};

type ExtracaoDadosModalProps = {
  readonly token: string;
  /**
   * Unidade que já vem selecionada — a do gestor no Consolidado dele. Na visão
   * corporativa (consulta/PCP/TI) não existe unidade ativa: passe vazio e
   * o modal começa com todas as unidades autorizadas marcadas.
   */
  readonly unidadeAtiva?: string;
  readonly defaultStartMonth: string;   // "YYYY-MM"
  readonly defaultEndMonth: string;     // "YYYY-MM"
  readonly onClose: () => void;
};

/** Quantos itens cada lista mostra por vez — milhares de checkboxes travariam a UI. */
const MAX_PRODUTOS_VISIVEIS = 60;
const MAX_FAMILIAS_VISIVEIS = 60;

/**
 * Seletor de mês/ano.
 *
 * Substitui `<input type="month">` de propósito: o widget nativo é rotulado pelo
 * locale do NAVEGADOR, então continuava em português mesmo com a interface em
 * inglês ou espanhol — o i18next não alcança aquele controle. Com dois selects
 * próprios, o mês vem de `common.months` e acompanha o idioma escolhido.
 */
type SeletorMesProps = {
  readonly valor:    string;              // "YYYY-MM"
  readonly meses:    ReadonlyArray<string>;
  readonly anos:     ReadonlyArray<number>;
  readonly onChange: (valor: string) => void;
  readonly rotulo:   string;
};

const SeletorMes = ({ valor, meses, anos, onChange, rotulo }: SeletorMesProps) => {
  const ano = valor.substring(0, 4);
  const mes = valor.substring(5, 7);

  return (
    <div className="flex items-center gap-1.5">
      <Dropdown
        aria={`${rotulo} — ${meses[Number(mes) - 1] ?? mes}`}
        valor={mes}
        className="min-w-[6.5rem] px-3 py-2 bg-white border border-slate-200 rounded-xl"
        opcoes={meses.map((nome, indice) => ({
          valor:  String(indice + 1).padStart(2, '0'),
          rotulo: nome,
        }))}
        onChange={(novoMes) => onChange(`${ano}-${novoMes}`)}
      />
      <Dropdown
        aria={`${rotulo} — ${ano}`}
        valor={ano}
        className="min-w-[5.5rem] px-3 py-2 bg-white border border-slate-200 rounded-xl"
        opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
        onChange={(novoAno) => onChange(`${novoAno}-${mes}`)}
      />
    </div>
  );
};

const alternar = (conjunto: Set<string>, valor: string): Set<string> => {
  const proximo = new Set(conjunto);
  if (proximo.has(valor)) proximo.delete(valor);
  else proximo.add(valor);
  return proximo;
};

export const ExtracaoDadosModal = ({
  token,
  unidadeAtiva,
  defaultStartMonth,
  defaultEndMonth,
  onClose,
}: ExtracaoDadosModalProps) => {
  const { t } = useTranslation('consolidado');

  // Nomes de mês do namespace common — mesma fonte que o resto do app usa.
  const meses = t('months', { ns: 'common', returnObjects: true });
  const nomesDosMeses: string[] = Array.isArray(meses) && meses.length === 12
    ? meses.map((m) => String(m))
    : ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

  const [filtros, setFiltros]   = useState<FiltrosDisponiveis | null>(null);
  const [loading, setLoading]   = useState(true);
  const [baixando, setBaixando] = useState(false);
  const [erro, setErro]         = useState<string | null>(null);

  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [endMonth,   setEndMonth]   = useState(defaultEndMonth);
  const [nivel,      setNivel]      = useState<Nivel>('produto');

  const [unidadesSel, setUnidadesSel] = useState<Set<string>>(
    () => (unidadeAtiva ? new Set([unidadeAtiva]) : new Set())
  );
  const [familiasSel, setFamiliasSel] = useState<Set<string>>(new Set());
  const [produtosSel, setProdutosSel] = useState<Set<string>>(new Set());
  const [metricasSel, setMetricasSel] = useState<Set<string>>(new Set(['orc', 'fcts', 'vendas']));

  const [buscaProduto, setBuscaProduto] = useState('');
  const [buscaFamilia, setBuscaFamilia] = useState('');

  useEffect(() => {
    const carregar = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/extracao/filtros', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const dados: FiltrosDisponiveis = await res.json();
        setFiltros(dados);
        // Visão corporativa: sem unidade ativa, começa com todas marcadas.
        if (!unidadeAtiva) {
          setUnidadesSel(new Set(dados.unidades.map((u) => u.codigo)));
        }
      } catch (err) {
        console.error('[extracao] falha ao carregar filtros:', err);
        setErro(t('extracao.erroFiltros'));
      } finally {
        setLoading(false);
      }
    };
    carregar();
  }, [token, t, unidadeAtiva]);

  const familiasFiltradas = useMemo(() => {
    if (!filtros) return [];
    const busca = buscaFamilia.trim().toLowerCase();
    if (!busca) return filtros.familias;
    return filtros.familias.filter((f) => f.toLowerCase().includes(busca));
  }, [filtros, buscaFamilia]);

  // Produtos oferecidos: respeitam as famílias marcadas e o texto da busca.
  const produtosFiltrados = useMemo(() => {
    if (!filtros) return [];
    const busca = buscaProduto.trim().toLowerCase();
    return filtros.produtos.filter((p) => {
      if (familiasSel.size > 0 && !familiasSel.has(p.familia)) return false;
      if (!busca) return true;
      return (
        p.codigo.toLowerCase().includes(busca) ||
        p.descricao.toLowerCase().includes(busca)
      );
    });
  }, [filtros, familiasSel, buscaProduto]);

  /**
   * Métricas na ordem canônica de `METRICAS`, não na ordem em que o usuário
   * clicou: é essa lista que define a ordem das colunas no CSV, e o resumo
   * abaixo precisa descrever exatamente o arquivo que será gerado.
   */
  const metricasOrdenadas = useMemo(
    () => METRICAS.filter((m) => metricasSel.has(m)),
    [metricasSel]
  );

  const mesesNoPeriodo = useMemo(() => {
    const [anoInicio, mesInicio] = startMonth.split('-').map(Number);
    const [anoFim, mesFim]       = endMonth.split('-').map(Number);
    if (!anoInicio || !mesInicio || !anoFim || !mesFim) return 0;
    return (anoFim - anoInicio) * 12 + (mesFim - mesInicio) + 1;
  }, [startMonth, endMonth]);

  /**
   * Cabeçalho exato do arquivo. Espelha `METRICA_LABEL` e as colunas base de
   * `gerarCsv` em backend/src/services/extracao.service.ts — os rótulos ficam
   * em português no CSV independentemente do idioma da interface, e o resumo
   * mostra o que o usuário vai realmente abrir no Excel. Ao mudar as colunas
   * lá, mude aqui.
   */
  const colunasDoArquivo = useMemo(() => {
    const rotuloMetrica: Record<Metrica, string> = {
      orc:              'ORC',
      fcts:             'FCST',
      vendas:           'Vendas',
      desvioFctsOrc:    'Desvio FCST-ORC',
      desvioVendasFcts: 'Desvio Vendas-FCST',
    };
    const base = nivel === 'familia'
      ? ['Unidade', 'Descrição da unidade', 'Família', 'Mês']
      : ['Unidade', 'Descrição da unidade', 'Família', 'Produto', 'Descrição do produto', 'Classe', 'Mês'];
    return [...base, ...metricasOrdenadas.map((m) => rotuloMetrica[m])];
  }, [nivel, metricasOrdenadas]);

  /**
   * Anos oferecidos: apenas os que têm dados no snapshot. Se o backend não
   * informar o intervalo, cai numa janela em torno do ano corrente para o
   * seletor nunca ficar vazio.
   */
  const anosDisponiveis = useMemo(() => {
    const anoAtual  = new Date().getFullYear();
    const anoInicio = filtros?.periodo ? Number(filtros.periodo.min.substring(0, 4)) : anoAtual - 3;
    const anoFim    = filtros?.periodo ? Number(filtros.periodo.max.substring(0, 4)) : anoAtual + 1;
    const lista: number[] = [];
    for (let a = anoInicio; a <= anoFim; a += 1) lista.push(a);
    return lista;
  }, [filtros]);

  /** "2026-06" → "Jun/2026", com o mês no idioma da interface. */
  const rotuloMes = (valor: string): string =>
    `${nomesDosMeses[Number(valor.substring(5, 7)) - 1] ?? valor.substring(5, 7)}/${valor.substring(0, 4)}`;

  const periodoInvalido = startMonth > endMonth;
  const podeExtrair =
    !loading && !baixando && !periodoInvalido &&
    unidadesSel.size > 0 && metricasSel.size > 0;

  const extrair = async () => {
    setBaixando(true);
    setErro(null);
    try {
      const res = await fetch('/api/extracao/csv', {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startMonth,
          endMonth,
          unidades: [...unidadesSel],
          familias: [...familiasSel],
          produtos: nivel === 'produto' ? [...produtosSel] : [],
          metricas: [...metricasOrdenadas],
          nivel,
        }),
      });

      if (!res.ok) {
        const corpo: unknown = await res.json().catch(() => null);
        const mensagem =
          typeof corpo === 'object' && corpo !== null && 'error' in corpo &&
          typeof (corpo as { error: unknown }).error === 'string'
            ? (corpo as { error: string }).error
            : t('extracao.erroDownload');
        setErro(mensagem);
        return;
      }

      // Nome sugerido pelo backend (Content-Disposition); fallback local se ausente.
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const casado      = /filename="([^"]+)"/.exec(disposition);
      const nome        = casado?.[1] ?? `forecast_${startMonth}_a_${endMonth}.csv`;

      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href     = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error('[extracao] falha no download:', err);
      setErro(t('extracao.erroDownload'));
    } finally {
      setBaixando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[88vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-sky-50 rounded-lg">
              <Download className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{t('extracao.titulo')}</h3>
              <p className="text-xs text-slate-400">{t('extracao.subtitulo')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            aria-label={t('extracao.fechar')}
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('extracao.carregando')}
            </div>
          )}

          {!loading && filtros && (
            <>
              {/* Período */}
              <section className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <CalendarRange className="w-3.5 h-3.5" />
                  {t('extracao.periodo')}
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <SeletorMes
                    valor={startMonth}
                    meses={nomesDosMeses}
                    anos={anosDisponiveis}
                    onChange={setStartMonth}
                    rotulo={t('extracao.periodo')}
                  />
                  <span className="text-slate-400 text-sm">{t('extracao.ate')}</span>
                  <SeletorMes
                    valor={endMonth}
                    meses={nomesDosMeses}
                    anos={anosDisponiveis}
                    onChange={setEndMonth}
                    rotulo={t('extracao.periodo')}
                  />
                </div>
                {periodoInvalido && (
                  <p className="text-xs text-rose-600">{t('extracao.periodoInvalido')}</p>
                )}
                <p className="text-xs text-slate-400">{t('extracao.periodoAviso')}</p>
              </section>

              {/* Unidades */}
              {filtros.unidades.length > 1 && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <Building2 className="w-3.5 h-3.5" />
                      {t('extracao.unidades')}
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setUnidadesSel(new Set(filtros.unidades.map((u) => u.codigo)))}
                        className="text-xs text-sky-600 hover:text-sky-700"
                      >
                        {t('extracao.selecionarTodas')}
                      </button>
                      <span className="text-slate-200">|</span>
                      <button
                        onClick={() => setUnidadesSel(new Set())}
                        className="text-xs text-sky-600 hover:text-sky-700"
                      >
                        {t('extracao.limpar')}
                      </button>
                    </div>
                  </div>
                  {unidadesSel.size === 0 && (
                    <p className="text-xs text-rose-600">{t('extracao.semUnidade')}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {filtros.unidades.map((u) => {
                      const ativa = unidadesSel.has(u.codigo);
                      return (
                        <button
                          key={u.codigo}
                          onClick={() => setUnidadesSel((prev) => alternar(prev, u.codigo))}
                          // O código fica no title: some do rótulo, mas continua
                          // consultável — é ele que identifica a unidade no ERP.
                          title={`${u.codigo} · ${u.descricao}`}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                            ativa
                              ? 'bg-sky-50 border-sky-300 text-sky-700'
                              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                          )}
                        >
                          {u.descricao}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Nível de detalhe */}
              <section className="space-y-2">
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  <Layers className="w-3.5 h-3.5" />
                  {t('extracao.nivel')}
                </label>
                <div className="flex gap-2">
                  {(['produto', 'familia'] as const).map((opcao) => (
                    <button
                      key={opcao}
                      onClick={() => setNivel(opcao)}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-xl text-sm font-medium border transition-colors',
                        nivel === opcao
                          ? 'bg-sky-50 border-sky-300 text-sky-700'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      )}
                    >
                      {t(`extracao.nivel_${opcao}`)}
                    </button>
                  ))}
                </div>
              </section>

              {/* Métricas */}
              <section className="space-y-2">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {t('extracao.metricas')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {METRICAS.map((metrica) => {
                    const ativa = metricasSel.has(metrica);
                    return (
                      <button
                        key={metrica}
                        onClick={() => setMetricasSel((prev) => alternar(prev, metrica))}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition-colors text-left',
                          ativa
                            ? 'bg-sky-50 border-sky-300 text-sky-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        )}
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded flex items-center justify-center shrink-0 border',
                            ativa ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                          )}
                        >
                          {ativa && <Check className="w-3 h-3 text-white" />}
                        </span>
                        {t(`extracao.metrica_${metrica}`)}
                      </button>
                    );
                  })}
                </div>
                {metricasSel.size === 0 && (
                  <p className="text-xs text-rose-600">{t('extracao.semMetrica')}</p>
                )}
              </section>

              {/* Famílias */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {t('extracao.familias')}
                  </label>
                  {familiasSel.size > 0 && (
                    <button
                      onClick={() => setFamiliasSel(new Set())}
                      className="text-xs text-sky-600 hover:text-sky-700"
                    >
                      {t('extracao.limpar')}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {familiasSel.size === 0
                    ? t('extracao.familiasTodas')
                    : t('extracao.familiasSelecionadas', { qtd: familiasSel.size })}
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={buscaFamilia}
                    onChange={(e) => setBuscaFamilia(e.target.value)}
                    placeholder={t('extracao.buscarFamilia')}
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-400"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                  {familiasFiltradas.slice(0, MAX_FAMILIAS_VISIVEIS).map((familia) => {
                    const ativa = familiasSel.has(familia);
                    return (
                      <button
                        key={familia}
                        onClick={() => setFamiliasSel((prev) => alternar(prev, familia))}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span
                          className={cn(
                            'w-4 h-4 rounded flex items-center justify-center shrink-0 border',
                            ativa ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                          )}
                        >
                          {ativa && <Check className="w-3 h-3 text-white" />}
                        </span>
                        <span className="text-sm text-slate-700 truncate">{familia}</span>
                      </button>
                    );
                  })}
                  {familiasFiltradas.length === 0 && (
                    <p className="px-3 py-4 text-xs text-slate-400 text-center">
                      {t('extracao.nenhumaFamilia')}
                    </p>
                  )}
                </div>
                {familiasFiltradas.length > MAX_FAMILIAS_VISIVEIS && (
                  <p className="text-xs text-slate-400">
                    {t('extracao.familiasOcultas', {
                      visiveis: MAX_FAMILIAS_VISIVEIS,
                      total:    familiasFiltradas.length,
                    })}
                  </p>
                )}
              </section>

              {/* Produtos — só faz sentido no nível produto */}
              {nivel === 'produto' && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <Package className="w-3.5 h-3.5" />
                      {t('extracao.produtos')}
                    </label>
                    {produtosSel.size > 0 && (
                      <button
                        onClick={() => setProdutosSel(new Set())}
                        className="text-xs text-sky-600 hover:text-sky-700"
                      >
                        {t('extracao.limpar')}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    {produtosSel.size === 0
                      ? t('extracao.produtosTodos')
                      : t('extracao.produtosSelecionados', { qtd: produtosSel.size })}
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={buscaProduto}
                      onChange={(e) => setBuscaProduto(e.target.value)}
                      placeholder={t('extracao.buscarProduto')}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-sky-400"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                    {produtosFiltrados.slice(0, MAX_PRODUTOS_VISIVEIS).map((p) => {
                      const ativa = produtosSel.has(p.codigo);
                      return (
                        <button
                          key={p.codigo}
                          onClick={() => setProdutosSel((prev) => alternar(prev, p.codigo))}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                        >
                          <span
                            className={cn(
                              'w-4 h-4 rounded flex items-center justify-center shrink-0 border',
                              ativa ? 'bg-sky-500 border-sky-500' : 'border-slate-300'
                            )}
                          >
                            {ativa && <Check className="w-3 h-3 text-white" />}
                          </span>
                          <span className="text-xs font-mono text-slate-500 shrink-0">{p.codigo}</span>
                          <span className="text-sm text-slate-700 truncate">{p.descricao}</span>
                        </button>
                      );
                    })}
                    {produtosFiltrados.length === 0 && (
                      <p className="px-3 py-4 text-xs text-slate-400 text-center">
                        {t('extracao.nenhumProduto')}
                      </p>
                    )}
                  </div>
                  {produtosFiltrados.length > MAX_PRODUTOS_VISIVEIS && (
                    <p className="text-xs text-slate-400">
                      {t('extracao.produtosOcultos', {
                        visiveis: MAX_PRODUTOS_VISIVEIS,
                        total:    produtosFiltrados.length,
                      })}
                    </p>
                  )}
                </section>
              )}
            </>
          )}

          {/* Resumo — o que o arquivo vai conter, antes de gerar */}
          {!loading && filtros && (
            <section className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wide">
                <FileSpreadsheet className="w-3.5 h-3.5" />
                {t('extracao.resumoTitulo')}
              </h4>

              <ul className="space-y-1 text-xs text-slate-600">
                <li>
                  · {t('extracao.resumoPeriodo', {
                        inicio: rotuloMes(startMonth),
                        fim:    rotuloMes(endMonth),
                        qtd:    Math.max(mesesNoPeriodo, 0),
                      })}
                </li>
                <li>
                  · {t('extracao.resumoUnidades', {
                        lista: [...unidadesSel].sort().join(', ') || '—',
                        qtd:   unidadesSel.size,
                      })}
                </li>
                <li>· {t(`extracao.resumoLinha_${nivel}`)}</li>
                <li>
                  · {familiasSel.size === 0
                        ? t('extracao.resumoFamiliasTodas')
                        : t('extracao.resumoFamiliasSelecao', {
                            lista: [...familiasSel].sort().join(', '),
                            qtd:   familiasSel.size,
                          })}
                </li>
                {nivel === 'produto' && (
                  <li>
                    · {produtosSel.size === 0
                          ? t('extracao.resumoProdutosTodos')
                          : t('extracao.resumoProdutosSelecao', { qtd: produtosSel.size })}
                  </li>
                )}
              </ul>

              <div className="pt-1">
                <p className="text-xs font-semibold text-slate-500 mb-1">
                  {t('extracao.resumoColunas', { qtd: colunasDoArquivo.length })}
                </p>
                <div className="flex flex-wrap gap-1">
                  {colunasDoArquivo.map((coluna) => (
                    <span
                      key={coluna}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[11px] font-mono text-slate-600"
                    >
                      {coluna}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-200">
                {t('extracao.resumoFormato')}
              </p>
            </section>
          )}

          {erro && (
            <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-700">{erro}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 border-t border-slate-100 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {t('extracao.cancelar')}
          </button>
          <button
            onClick={extrair}
            disabled={!podeExtrair}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors',
              podeExtrair
                ? 'bg-sky-600 text-white hover:bg-sky-700'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            )}
          >
            {baixando
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />}
            {baixando ? t('extracao.gerando') : t('extracao.baixarCsv')}
          </button>
        </div>
      </div>
    </div>
  );
};
