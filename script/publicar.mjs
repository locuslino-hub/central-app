// Envia script/dist ao Google e aponta a implantação para a versão nova: a URL
// /exec só roda o que está implantado. O id da implantação fica fora do
// repositório, na variável CENTRAL_IMPLANTACAO ou no arquivo ignorado script/.implantacao.
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

export function publicar({ env, lerArquivo, rodar }) {
  const id = idDaImplantacao({ env, lerArquivo });
  rodar(['push', '-f']);
  rodar(['deploy', '-i', id]);
}

const pasta = dirname(fileURLToPath(import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    publicar({
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
