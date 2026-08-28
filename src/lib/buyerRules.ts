/**
 * Configuração e regras do módulo "Comprador".
 * A senha é temporária e fica isolada aqui para troca futura sem mexer no restante do código.
 */
export const BUYER_MODULE_PASSWORD = "2606";

export function isBuyerModuleAccessGranted(password: string): boolean {
  return password.trim() === BUYER_MODULE_PASSWORD;
}

export const BUYERS = ["Marcelo", "Suellen", "Maurício"] as const;
export type Buyer = (typeof BUYERS)[number];

/** Pesos de distribuição da dotação mensal por dia da semana (domingo = 0). */
export const WEEKDAY_WEIGHTS = [0.1033, 0.1473, 0.1473, 0.1473, 0.1461, 0.1508, 0.158] as const;
export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

/** Dias críticos do mês, com meta reduzida fixa. */
export const CRITICAL_DAYS = [5, 10, 15, 20, 25] as const;
export const CRITICAL_FACTOR = 0.85;

const normalize = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/** Reconhece o comprador a partir de um texto livre (cabeçalho de planilha, seleção, etc.). */
export function matchBuyer(value: string): Buyer | null {
  const target = normalize(value);
  if (!target) return null;
  return BUYERS.find((buyer) => target.includes(normalize(buyer))) ?? null;
}

export function isCriticalDate(date: string): boolean {
  const day = new Date(`${date}T12:00:00`).getDate();
  return (CRITICAL_DAYS as readonly number[]).includes(day);
}

export function weekdayIndex(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

export function weekdayLabel(date: string): string {
  return WEEKDAY_LABELS[weekdayIndex(date)] ?? "";
}

/** Meta diária = dotação mensal × peso do dia da semana; dias críticos aplicam 85%. */
export function dailyGoal(monthlyBudget: number, date: string) {
  const weight = WEEKDAY_WEIGHTS[weekdayIndex(date)] ?? 0;
  const normalGoal = monthlyBudget * weight;
  const critical = isCriticalDate(date);
  return {
    weight,
    weekday: weekdayLabel(date),
    isCritical: critical,
    normalGoal,
    goal: critical ? normalGoal * CRITICAL_FACTOR : normalGoal,
  };
}

export const BUYER_BUSINESS_RULES = [
  "A meta de compra é 60% da venda mensal de cada comprador, alimentada todo mês.",
  "A dotação é distribuída pelos dias da semana usando os pesos: Dom 10,33% · Seg/Ter/Qua 14,73% · Qui 14,61% · Sex 15,08% · Sáb 15,80%.",
  "Dias críticos (05, 10, 15, 20, 25): meta reduzida para 85% da meta normal, fixa.",
  "Sem compensação entre dias: folga ou estouro de um dia não migra para outro.",
  "O IP identifica o comprador; IP não cadastrado bloqueia a simulação.",
  "Pagamentos lançados por comprador e por data de vencimento; somente compras.",
] as const;
