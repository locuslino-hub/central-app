// A serifa dos títulos (Instrument Serif) não tem algarismos alinhados: o "1"
// parece um "l". Nos textos em serifa, cada número sai na letra da interface.

/** Texto com os números (e horas, "14:00") na letra da interface. */
export function ComNumeros({ texto }: { texto: string }) {
  const partes = texto.split(/(\d+(?:[:,.]\d+)*)/);
  return (
    <>
      {partes.map((parte, i) =>
        i % 2 === 1 ? (
          <span key={i} class="num">
            {parte}
          </span>
        ) : (
          parte
        ),
      )}
    </>
  );
}
