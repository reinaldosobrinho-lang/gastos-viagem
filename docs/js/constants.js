// Constantes compartilhadas (sem dados pessoais).
export const CURRENCIES = [
  ['USD', 'Dólar americano'], ['EUR', 'Euro'], ['GBP', 'Libra esterlina'],
  ['CAD', 'Dólar canadense'], ['AUD', 'Dólar australiano'], ['CHF', 'Franco suíço'],
  ['JPY', 'Iene japonês'], ['MXN', 'Peso mexicano'], ['ARS', 'Peso argentino'],
  ['CLP', 'Peso chileno'], ['UYU', 'Peso uruguaio'], ['BRL', 'Real brasileiro'],
  ['AED', 'Dirham dos Emirados'], ['CNY', 'Yuan chinês'], ['KRW', 'Won sul-coreano'],
  ['THB', 'Baht tailandês'],
].map(([code, name]) => ({ code, name }));

export const CATEGORIES = [
  ['alimentacao', 'Alimentação'], ['transporte', 'Transporte'], ['hospedagem', 'Hospedagem'],
  ['compras', 'Compras'], ['passeios', 'Passeios e ingressos'], ['saude', 'Saúde'],
  ['outros', 'Outros'],
].map(([id, label]) => ({ id, label }));

export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? 'Outros';

export const ACTIVITY_STATUS = [
  ['planned', 'Planejada'], ['done', 'Concluída'], ['cancelled', 'Cancelada'],
].map(([id, label]) => ({ id, label }));

export const PERSON_IDS = ['p1', 'p2', 'p3'];
export const MAX_TRIP_DAYS = 400;
