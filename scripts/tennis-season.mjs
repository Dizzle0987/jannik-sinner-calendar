export const TIME_ZONE = "Europe/Rome";

export function fallbackSeason(date) {
  return Number(new Intl.DateTimeFormat("en", {
    timeZone: TIME_ZONE,
    year: "numeric",
  }).format(date));
}

export function parseIcsDate(value) {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?/);
  if (!match) return null;
  const [, year, month, day, hour = "12", minute = "00", second = "00"] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
}
