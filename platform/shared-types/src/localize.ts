/**
 * Localized UI-facing messages for the ApiError envelope (ADR-007 §4).
 *
 * Every service's `errorHandler` resolves the locale from the request
 * `Accept-Language` / `x-language` headers and passes it here. Only Russian
 * (`ru` / `ru-*`) is translated; any other locale falls back to the original
 * English message so existing behavior is fully backward compatible.
 */

const RUSSIAN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  NOT_FOUND: "Ресурс не найден.",
  CONFLICT: "Конфликт данных: запись уже существует или была изменена.",
  VALIDATION_ERROR: "Ошибка валидации: проверьте корректность отправленных данных.",
  INTERNAL_ERROR: "Внутренняя ошибка сервера. Попробуйте повторить позже.",
  RATE_LIMITED: "Слишком много запросов. Повторите попытку позже.",
  // Fastify core error codes
  FST_ERR_NOT_FOUND: "Запрошенный маршрут не найден.",
  FST_ERR_VALIDATION: "Некорректные данные запроса: не пройдена валидация схемы.",
  FST_ERR_CTP_INVALID_MEDIA_TYPE: "Неподдерживаемый тип содержимого (Content-Type).",
  FST_ERR_CTP_EMPTY_JSON_BODY: "Пустое JSON-тело запроса.",
  FST_ERR_CTP_INVALID_JSON_BODY: "Некорректный JSON в теле запроса.",
  FST_ERR_CTP_BODY_TOO_LARGE: "Слишком большой размер тела запроса.",
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: "Некорректный заголовок Content-Length.",
};

/**
 * Extracts the primary language tag from an `Accept-Language`/`x-language`
 * header value, e.g. `"ru-RU,ru;q=0.9,en;q=0.8"` → `"ru"`, `"en-US"` → `"en"`,
 * `"*"` → `"*"`, `undefined`/empty → `""`.
 */
function primaryLanguage(locale: string | null | undefined): string {
  if (!locale) return "";
  const range = locale.split(",")[0]?.trim().split(";")[0]?.trim() ?? "";
  return (range.split("-")[0] ?? range.split("_")[0] ?? "").toLowerCase();
}

/**
 * Returns a locale-aware UI message for the given ApiError `code`.
 *
 * - `locale` resolving to Russian (`ru`, `ru-RU`, …) and a known `code`
 *   returns the Russian translation from the dictionary.
 * - Any other locale, `*`, or a `code` without a Russian mapping returns the
 *   original `message` unchanged (English default, backward compatible).
 *
 * @example
 * localizeApiError("NOT_FOUND", "Note not found", "ru") // → "Ресурс не найден."
 * localizeApiError("NOT_FOUND", "Note not found", "en") // → "Note not found"
 */
export function localizeApiError(
  code: string,
  message: string,
  locale: string | null | undefined,
): string {
  if (primaryLanguage(locale) !== "ru") return message;
  return RUSSIAN_ERROR_MESSAGES[code] ?? message;
}
