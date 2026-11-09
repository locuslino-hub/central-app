// O arquivo do modelo da IA local (Tarefa 21), fixado num commit: o que baixa
// hoje é o que baixa amanhã. Fica à parte para a tela mostrar o tamanho sem
// levar o motor da IA junto.
export const MODELO = {
  url: 'https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/71064b01bd5e2bfd9a5f9dd52df86ae4800138c1/gemma-4-E4B-it-gpu.litertlm',
  /** Bytes. */
  tamanho: 2_969_059_328,
  arquivo: 'gemma-4-E4B-it-gpu.litertlm',
} as const;
