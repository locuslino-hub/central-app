// Fixa o fuso antes de os workers do Vitest iniciarem (funciona no Windows).
export default function setup() {
  process.env.TZ = 'Europe/Lisbon';
}
