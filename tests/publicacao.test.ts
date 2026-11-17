import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// O fluxo de publicação, lido como texto (sem dependência nova para YAML).
const FLUXO = readFileSync(join(__dirname, '../.github/workflows/publicar.yml'), 'utf8').replace(/\r\n/g, '\n');

/** O trecho de um job: da linha `  nome:` até o próximo job (ou o fim). */
function job(nome: string): string {
  const inicio = FLUXO.indexOf(`\n  ${nome}:\n`);
  if (inicio < 0) return '';
  const resto = FLUXO.slice(inicio + 1);
  const proximo = resto.slice(1).search(/\n {2}[\w-]+:\n/);
  return proximo < 0 ? resto : resto.slice(0, proximo + 1);
}

describe('publicação (C-26)', () => {
  it('o checkout traz o histórico inteiro, para o teste do histórico correr no CI', () => {
    expect(FLUXO).toMatch(/uses: actions\/checkout@v4\n\s+with:\n(\s+#.*\n)*\s+fetch-depth: 0/);
  });
});

describe('publicação (C-22)', () => {
  it('não há permissão de publicar para o fluxo inteiro', () => {
    const antesDosJobs = FLUXO.slice(0, FLUXO.indexOf('\njobs:'));
    expect(antesDosJobs).not.toMatch(/pages: write|id-token: write/);
  });

  it('o job que instala e testa só lê o repositório', () => {
    const construir = job('construir');
    expect(construir).toMatch(/permissions:\n\s+contents: read/);
    expect(construir).not.toMatch(/pages: write|id-token: write/);
    expect(construir).toMatch(/npm ci/);
    expect(construir).toMatch(/upload-pages-artifact/);
  });

  it('o job que publica depende do construir e não roda código de pacotes', () => {
    const publicar = job('publicar');
    expect(publicar).toMatch(/needs: construir/);
    expect(publicar).toMatch(/pages: write/);
    expect(publicar).toMatch(/id-token: write/);
    expect(publicar).not.toMatch(/\brun:/);
    expect(publicar).toMatch(/deploy-pages/);
  });
});
