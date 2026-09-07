import React from 'react';

/**
 * Ícone inspirado no logo oficial do Apache Airflow:
 * círculo azul (#017CEE) com três pás simétricas em branco (pinwheel).
 */
export function AirflowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Apache Airflow"
    >
      {/* Fundo azul Airflow */}
      <circle cx="12" cy="12" r="12" fill="#017CEE" />

      {/* Pá 1 — aponta para cima, inclinada para a esquerda */}
      <path
        d="M12 12 C10.5 10 10 7.5 12 6 C14 4.5 14.5 7.5 12 12Z"
        fill="white"
      />

      {/* Pá 2 — aponta para a direita-baixo, inclinada para cima */}
      <path
        d="M12 12 C14.5 12 16.5 13.5 17 15.5 C17.5 17.5 14.5 17 12 12Z"
        fill="white"
      />

      {/* Pá 3 — aponta para a esquerda-baixo, inclinada para baixo */}
      <path
        d="M12 12 C10.5 14 8 15 6.5 13.5 C5 12 7.5 10.5 12 12Z"
        fill="white"
        opacity="0.75"
      />

      {/* Cubo central */}
      <circle cx="12" cy="12" r="2" fill="#017CEE" />
    </svg>
  );
}
