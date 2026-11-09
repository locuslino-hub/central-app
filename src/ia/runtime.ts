// Os arquivos do motor da IA guardados no aparelho (Tarefa 22), para a IA abrir
// sem internet. O modelo fica na pasta privada (src/ia/trabalhador.ts); o motor
// que o roda (o carregador `.js` e o `.wasm` do LiteRT-LM, em `litertlm/<versão>/`
// do app) fica aqui, num armazenamento próprio com a versão no nome
// (`litertlm-<versão>`).
//
// - Só a variante que este navegador usa (de 24 a 37 MB), não as quatro.
// - Preenchido quando o modelo é baixado, ou na primeira abertura com internet de
//   quem já tinha o modelo. Nunca pelo service worker do app (vite.config.ts):
//   quem não usa a IA não leva nada disso.
// - A IA abre com endereços locais (Blob URL) dos arquivos guardados.

const PREFIXO = 'litertlm-';

/**
 * Qual dos quatro builds do LiteRT-LM este navegador usa: a mesma regra do
 * pacote (`load.js` do `@litert-lm/core`), que escolhe pelo nome do arquivo.
 */
export function nomeDaVariante(simdRelaxado: boolean, jspi: boolean): string {
  if (simdRelaxado) return jspi ? 'litertlm_wasm_internal' : 'litertlm_wasm_asyncify_internal';
  return jspi ? 'litertlm_wasm_compat_internal' : 'litertlm_wasm_compat_asyncify_internal';
}

// O mesmo teste de SIMD relaxado do pacote (`wasm_feature_detect.js`).
const TESTE_SIMD_RELAXADO = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 15, 1, 13, 0, 65, 1, 253, 15, 65, 2, 253, 15, 253,
  128, 2, 11,
]);

/** A variante para o navegador em que este código roda. */
export async function varianteDoNavegador(): Promise<string> {
  const simdRelaxado = await WebAssembly.instantiate(TESTE_SIMD_RELAXADO).then(
    () => true,
    () => false,
  );
  return nomeDaVariante(simdRelaxado, 'Suspending' in WebAssembly);
}

/** O pedaço do Cache Storage usado aqui. */
export type Caixa = {
  match(url: string): Promise<Response | undefined>;
  put(url: string, resposta: Response): Promise<void>;
};
export type Armazem = {
  open(nome: string): Promise<Caixa>;
  keys(): Promise<string[]>;
  delete(nome: string): Promise<boolean>;
};

/** Endereços locais dos arquivos do motor, prontos para o carregador do pacote. */
export type ArquivosDoMotor = {
  /** O carregador `.js`, terminado em `#<variante>.js` (o pacote só aceita endereço que termina em `.js`). */
  js: string;
  wasm: string;
  /** Solta os endereços locais, depois que o motor carregou. */
  liberar(): void;
};

export type Runtime = {
  /** Guarda o que falta dos arquivos da variante, baixando da pasta `litertlm/<versão>/` do app. */
  guardar(pasta: string): Promise<void>;
  /** Os arquivos guardados, como endereços locais. Falha se não estão guardados. */
  abrir(pasta: string): Promise<ArquivosDoMotor>;
  /** Tira os arquivos do motor do aparelho (de qualquer versão). */
  apagar(): Promise<void>;
};

type Opcoes = {
  armazem: Armazem;
  /** Versão do `@litert-lm/core`. */
  versao: string;
  variante(): Promise<string>;
  baixar(url: string): Promise<Response>;
  criarUrl(blob: Blob): string;
  revogarUrl(url: string): void;
};

const TIPOS = { js: 'text/javascript', wasm: 'application/wasm' } as const;

export function runtimeGuardado({ armazem, versao, variante, baixar, criarUrl, revogarUrl }: Opcoes): Runtime {
  const nome = `${PREFIXO}${versao}`;
  const enderecos = async (pasta: string) => {
    const base = await variante();
    return { base, js: `${pasta}${base}.js`, wasm: `${pasta}${base}.wasm` };
  };
  const apagarOutras = async (manter?: string) => {
    for (const outro of await armazem.keys()) {
      if (outro.startsWith(PREFIXO) && outro !== manter) await armazem.delete(outro);
    }
  };

  return {
    async guardar(pasta) {
      const { js, wasm } = await enderecos(pasta);
      await apagarOutras(nome);
      const caixa = await armazem.open(nome);
      for (const url of [js, wasm]) {
        if (await caixa.match(url)) continue;
        const resposta = await baixar(url);
        if (!resposta.ok) throw new Error(`Arquivo do motor da IA: HTTP ${resposta.status} em ${url}`);
        await caixa.put(url, resposta);
      }
    },

    async abrir(pasta) {
      const { base, js, wasm } = await enderecos(pasta);
      const caixa = await armazem.open(nome);
      const [respostaJs, respostaWasm] = await Promise.all([caixa.match(js), caixa.match(wasm)]);
      if (!respostaJs || !respostaWasm) throw new Error('Os arquivos do motor da IA não estão guardados neste aparelho');
      const urlJs = criarUrl(new Blob([await respostaJs.blob()], { type: TIPOS.js }));
      const urlWasm = criarUrl(new Blob([await respostaWasm.blob()], { type: TIPOS.wasm }));
      return {
        js: `${urlJs}#${base}.js`,
        wasm: urlWasm,
        liberar() {
          revogarUrl(urlJs);
          revogarUrl(urlWasm);
        },
      };
    },

    apagar: () => apagarOutras(),
  };
}
