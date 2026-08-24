export const money = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const dateBR = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");

export const dayMonthBR = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export const iso = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

export const parseBRL = (value: string) => {
  const normalized = value
    .replace(/\s/g, "")
    .replace(/R\$?/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parseTerms = (value: string) =>
  value
    .split(/[\s,;]+/)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .slice(0, 12);

export const criticalLabel = (date: string) =>
  (
    {
      5: "Folha de pagamento",
      10: "Custos altos",
      15: "Impostos",
      20: "Adiantamento + impostos",
      25: "Impostos",
    } as Record<number, string>
  )[new Date(`${date}T12:00:00`).getDate()];
