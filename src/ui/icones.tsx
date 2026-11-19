// Ícones de traço, desenhados aqui para não depender de fonte nem de CDN.
// Sempre decorativos: o texto ao lado diz o que é.
const TRACOS = {
  painel: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  agora: 'M13 3 5 13.5h6L10.5 21 19 10h-6z',
  caixa: 'M4 13.5 6.5 5h11l2.5 8.5V19H4zM4 13.5h4.5a3.5 3.5 0 0 0 7 0H20',
  salas: 'M6 20V4.5h12V20M4 20h16M14.5 12.5v.01',
  chat: 'M20 12a8 7 0 0 1-11.6 6.5L4 19.5l1.3-3.6A7 7 0 0 1 4 12a8 7 0 0 1 16 0',
  // Três pontos desenhados como círculos pequenos: o traço é o mesmo dos outros ícones.
  mais: 'M5.5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0M18.5 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  semana: 'M5 5.5h14V19H5zM5 9.5h14M9 3.5v4M15 3.5v4M8.5 13h2M13.5 13h2M8.5 16h2',
  mes: 'M5 5.5h14V19H5zM5 9.5h14M9 3.5v4M15 3.5v4M9 14l2 2 4-4',
  ano: 'M5 5.5h14V19H5zM5 9.5h14M9 3.5v4M15 3.5v4M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16h.01M12 16h.01',
  quadro: 'M4.5 5h4.5v14H4.5zM10.5 5H15v9h-4.5zM16.5 5H21v6h-4.5z',
  atividades: 'M6 4.5h12V20H6zM9 9l1.5 1.5L13.5 7.5M9 15h6',
  'sem-prazo': 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16M12 8v4.5l2.5 1.5',
  conectar: 'M9 15 15 9M10.5 6.8l1-1a3.5 3.5 0 0 1 5 5l-1 1M13.5 17.2l-1 1a3.5 3.5 0 0 1-5-5l1-1',
  voltar: 'M15 5l-7 7 7 7',
  gota: 'M12 3.5c3 3.8 6 6.7 6 10.2a6 6 0 0 1-12 0c0-3.5 3-6.4 6-10.2z',
  fechar: 'M6 6l12 12M18 6 6 18',
  desfazer: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  parar: 'M7.5 7.5h9v9h-9z',
  microfone: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
  ideias: 'M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z',
  editar: 'M4.5 19.5l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3l-10 10zM13.5 7l3 3',
  pasta: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17z',
  'pasta-nova': 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17zM12 11v4.5M9.75 13.25h4.5',
  lista: 'M9.5 6.5H19M9.5 12H19M9.5 17.5H19M4.5 6.5l1.2 1.2 2-2.2M4.5 12l1.2 1.2 2-2.2M4.5 17.5l1.2 1.2 2-2.2',
  registro: 'M4 20h16M7 20v-6.5M12 20V6M17 20v-10',
  planilha: 'M4.5 5h15v14h-15zM4.5 10h15M4.5 14.5h15M10 5v14',
  raio: 'M13 3 6 13h5l-1 8 7-10h-5z',
  chama: 'M12 3c1 3.2 4.5 5 4.5 9.2a4.5 4.5 0 0 1-9 0c0-1.7.8-2.8 1.8-3.7.2 1.2.8 1.9 1.6 2.2C10.6 8.3 11 5.5 12 3z',
  externo: 'M13.5 5H19v5.5M19 5l-8 8M17 14.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3.5',
} as const;

export type NomeDoIcone = keyof typeof TRACOS;

export function Icone({ nome }: { nome: NomeDoIcone }) {
  return (
    <svg
      class="icone"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={TRACOS[nome]} />
    </svg>
  );
}
