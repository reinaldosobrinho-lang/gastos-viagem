// Ícones (emojis) das atividades. Só texto; nada é baixado.
export const ICON_CHOICES = [
  '🏰', '🎢', '🎡', '🎬', '🌐', '🦁', '🐬', '🚀', '🏖️', '🛍️', '🛒', '🍽️', '☕', '🍔',
  '🏟️', '🏒', '🏀', '⚽', '🏁', '🚗', '✈️', '🛋️', '🏨', '🎄', '🌳', '🚤', '🌹', '🌇',
  '📸', '🎟️', '🎭', '🎁', '💊', '📍',
];
export const DEFAULT_ICON = '📍';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Ordem importa: o primeiro padrão que combinar vence.
const RULES = [
  [/magic kingdom|castelo/, '🏰'],
  [/disney springs/, '🛍️'],
  [/epcot/, '🌐'],
  [/animal kingdom/, '🦁'],
  [/hollywood/, '🎬'],
  [/sea ?world|golfinho|aquario/, '🐬'],
  [/nasa|kennedy|foguete/, '🚀'],
  [/nascar|speedway|corrida/, '🏁'],
  [/nba|basquete/, '🏀'],
  [/jogo|tampa|nhl|hockey|estadio|arena/, '🏟️'],
  [/\bepic\b|universal|island/, '🎢'],
  [/praia|beach/, '🏖️'],
  [/outlet|shopping|compras|\bloop\b|tanger|vineland|\bmall\b/, '🛍️'],
  [/walmart|mercado|supermercado/, '🛒'],
  [/cafe da manha|\bcafe\b|brunch|padaria/, '☕'],
  [/almoc|jantar|restaurante|lanche/, '🍽️'],
  [/natal|celebration/, '🎄'],
  [/descanso|descansar|folga|dia livre/, '🛋️'],
  [/retorno|volta|chegada|\bvoo\b|aeroporto/, '✈️'],
  [/boat|barco|scenic/, '🚤'],
  [/rose garden|jardim/, '🌹'],
  [/central park|por do sol/, '🌇'],
  [/parque|park|trilha/, '🌳'],
  [/hotel|hospedagem|check-?in/, '🏨'],
];

/** Sugere um ícone pelo nome da atividade; devolve DEFAULT_ICON se nada combinar. */
export function suggestIcon(title) {
  const t = norm(String(title ?? ''));
  for (const [re, icon] of RULES) if (re.test(t)) return icon;
  return DEFAULT_ICON;
}
