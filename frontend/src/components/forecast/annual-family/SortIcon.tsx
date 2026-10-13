/**
 * Ícone de ordenação do cabeçalho da tabela anual (ativo asc/desc ou neutro).
 */
import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { SortCol, SortDir } from './helpers';

export const SortIcon: React.FC<{ col: NonNullable<SortCol>; active: SortCol; dir: SortDir }> = ({ col, active, dir }) => {
  if (active !== col) return <ArrowUpDown className="w-3 h-3 shrink-0" />;
  return dir === 'asc' ? <ArrowUp className="w-3 h-3 shrink-0" /> : <ArrowDown className="w-3 h-3 shrink-0" />;
};
