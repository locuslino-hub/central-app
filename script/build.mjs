// Monta script/dist para o clasp. O Apps Script não tem módulos e só enxerga
// funções declaradas no topo do arquivo, então o pacote fica dentro de uma IIFE
// e cada exportação de Codigo.ts ganha uma função global que a chama.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pasta = dirname(fileURLToPath(import.meta.url));
const saida = join(pasta, 'dist');
const NOME_GLOBAL = 'CentralScript';

const opcoes = {
  absWorkingDir: pasta,
  entryPoints: ['Codigo.ts'],
  bundle: true,
  write: false,
  charset: 'utf8',
  target: 'es2019',
};

// Primeiro em ESM só para saber o que Codigo.ts exporta: a lista nasce do
// código, sem uma segunda lista para esquecer de atualizar.
const { metafile } = await build({ ...opcoes, format: 'esm', metafile: true, outdir: 'dist' });
const [{ exports: exportadas }] = Object.values(metafile.outputs);

const { outputFiles } = await build({ ...opcoes, format: 'iife', globalName: NOME_GLOBAL });
const globais = exportadas.map(
  (nome) => `function ${nome}() {\n  return ${NOME_GLOBAL}.${nome}.apply(this, arguments);\n}\n`,
);

// Limpa antes: `clasp create` deixa arquivos aqui e o clasp envia tudo o que achar.
rmSync(saida, { recursive: true, force: true });
mkdirSync(saida);
writeFileSync(join(saida, 'Codigo.js'), outputFiles[0].text + '\n' + globais.join('\n'));
copyFileSync(join(pasta, 'appsscript.json'), join(saida, 'appsscript.json'));
