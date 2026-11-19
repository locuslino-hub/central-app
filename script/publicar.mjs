// Envia script/dist ao Google e aponta a implantação para a versão nova: a URL
// /exec só roda o que está implantado. O id da implantação fica fora do
// repositório, na variável CENTRAL_IMPLANTACAO ou no arquivo ignorado script/.implantacao.
//
// Três comandos:
//   enviar    (npm run script:enviar)    só `clasp push -f`: o código novo vai ao editor, a URL /exec continua na versão antiga.
//   implantar (npm run script:implantar) só `clasp deploy -i <id>`: a URL /exec passa a rodar o código enviado.
//   publicar  (npm run script:publicar)  os dois em sequência, como sempre. Só serve quando a versão nova não pede
//             permissão nova: com permissão nova, use enviar -> autorizar no editor -> implantar (ver GUIA.md).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function idDaImplantacao({ env, lerArquivo }) {
  let id = env.CENTRAL_IMPLANTACAO;
  if (!id) {
    try {
      id = lerArquivo().trim();
    } catch {
      id = '';
    }
  }
  if (!/^[\w-]+$/.test(id)) {
    throw new Error(
      'Falta o id da implantação: defina CENTRAL_IMPLANTACAO ou salve-o em script/.implantacao.',
    );
  }
  return id;
}

export function enviar({ rodar }) {
  rodar(['push', '-f']);
}

export function implantar({ env, lerArquivo, rodar }) {
  const id = idDaImplantacao({ env, lerArquivo });
  rodar(['deploy', '-i', id]);
}

export function publicar({ env, lerArquivo, rodar }) {
  // Confere o id antes de enviar qualquer coisa.
  idDaImplantacao({ env, lerArquivo });
  enviar({ rodar });
  implantar({ env, lerArquivo, rodar });
}

const pasta = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const etapas = { enviar, implantar, publicar };
  const etapa = etapas[process.argv[2] ?? 'publicar'];
  try {
    if (!etapa) throw new Error('Use: enviar, implantar ou publicar.');
    etapa({
      env: process.env,
      lerArquivo: () => readFileSync(join(pasta, '.implantacao'), 'utf8'),
      rodar: (argumentos) =>
        execSync(`npx clasp ${argumentos.join(' ')}`, { cwd: pasta, stdio: 'inherit' }),
    });
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
