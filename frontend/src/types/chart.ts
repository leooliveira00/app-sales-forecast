/**
 * Props que o Recharts injeta num tooltip customizado usado como
 * `<Tooltip content={<CustomTooltip />} />`. Declara só o que os tooltips do app leem.
 */
export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number }[];
}
