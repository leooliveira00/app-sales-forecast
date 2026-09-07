import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from './Common';

/**
 * Dropdown com painel próprio, no padrão visual da ferramenta.
 *
 * Existe porque a lista de um `<select>` nativo é desenhada pelo sistema
 * operacional e não aceita estilo: o campo fechado combinava com o formulário,
 * mas as opções abriam com a aparência do SO. Aqui o painel é markup comum, com
 * as mesmas convenções das outras listas do app (hover `slate-50`, item ativo em
 * `sky` com check).
 *
 * O gatilho herda o estilo do formulário onde está — daí `className` sobrepor as
 * classes de superfície, mantendo o campo visualmente igual aos inputs vizinhos.
 */

export type DropdownOption = { readonly valor: string; readonly rotulo: string };

type DropdownProps = {
  readonly valor:        string;
  readonly opcoes:       ReadonlyArray<DropdownOption>;
  readonly onChange:     (valor: string) => void;
  readonly aria:         string;
  /** Exibido quando `valor` não casa com nenhuma opção (ex.: nada selecionado). */
  readonly placeholder?: string;
  /** Classes de superfície do gatilho (largura, fundo, borda, raio). */
  readonly className?:   string;
  readonly disabled?:    boolean;
};

const GATILHO_BASE =
  'flex items-center justify-between gap-2 text-sm transition-colors ' +
  'focus:outline-none focus:ring-2 focus:ring-sky-400 disabled:opacity-50 disabled:cursor-not-allowed';

/** Superfície padrão: mesma dos inputs de formulário do app. */
const GATILHO_PADRAO = 'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg';

export const Dropdown = ({
  valor,
  opcoes,
  onChange,
  aria,
  placeholder,
  className,
  disabled = false,
}: DropdownProps) => {
  const [aberto, setAberto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (evento: MouseEvent) => {
      const alvo = evento.target;
      if (containerRef.current && alvo instanceof Node && !containerRef.current.contains(alvo)) {
        setAberto(false);
      }
    };
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') setAberto(false);
    };
    document.addEventListener('mousedown', aoClicarFora);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, [aberto]);

  const selecionada = opcoes.find((o) => o.valor === valor);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={aria}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        disabled={disabled}
        onClick={() => setAberto((estava) => !estava)}
        className={cn(
          GATILHO_BASE,
          className ?? GATILHO_PADRAO,
          aberto && 'border-sky-300'
        )}
      >
        <span className={cn('truncate', selecionada ? 'text-slate-700' : 'text-slate-400')}>
          {selecionada?.rotulo ?? placeholder ?? ''}
        </span>
        <ChevronDown
          className={cn('w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform', aberto && 'rotate-180')}
        />
      </button>

      {aberto && (
        <div
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1"
        >
          {opcoes.map((opcao) => {
            const ativa = opcao.valor === valor;
            return (
              <button
                key={opcao.valor}
                type="button"
                role="option"
                aria-selected={ativa}
                onClick={() => {
                  onChange(opcao.valor);
                  setAberto(false);
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                  ativa ? 'bg-sky-50 text-sky-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                <span className="truncate">{opcao.rotulo}</span>
                {ativa && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
          {opcoes.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">Nenhuma opção disponível</p>
          )}
        </div>
      )}
    </div>
  );
};
