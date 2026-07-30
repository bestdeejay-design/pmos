#!/usr/bin/env node
/**
 * gen-openapi.mjs — generates OpenAPI 3.1.0 contracts for the 14 remaining PMOS services.
 * Style mirrors contracts/openapi/{profiles,notes}.yaml:
 *   - servers.url = /api/<svc>/v1
 *   - common components: CorrelationId/Offset/Limit params, Error/ValidationError/
 *     NotFoundError/InternalError/Pagination schemas, ValidationError/NotFoundError/
 *     InternalError responses
 *   - CRUD + service-specific endpoints from FEATURES.md
 * Idempotent: overwrites existing generated contracts.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "contracts", "openapi");

// ---- reusable YAML fragments (exact style of profiles/notes) ----
const PARAMS = `  parameters:
    CorrelationId:
      name: x-correlation-id
      in: header
      required: true
      description: Уникальный идентификатор для трассировки запроса
      schema:
        type: string
        format: uuid
      example: a1b2c3d4-e5f6-7890-abcd-ef1234567890

    Offset:
      name: offset
      in: query
      required: false
      description: Смещение для пагинации (с какого элемента начинать)
      schema:
        type: integer
        minimum: 0
        default: 0
      example: 0

    Limit:
      name: limit
      in: query
      required: false
      description: Максимальное количество записей на страницу
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      example: 20
`;

const COMMON_SCHEMAS = `    # ─────────────────────── Error schemas ───────────────────────
    Error:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: string
          description: Код ошибки
        message:
          type: string
          description: Человекочитаемое описание ошибки
        details:
          oneOf:
            - type: object
            - type: 'null'
          description: Дополнительная информация об ошибке

    ValidationError:
      allOf:
        - $ref: '#/components/schemas/Error'
        - type: object
          properties:
            code:
              type: string
              enum: [VALIDATION_ERROR]
          example:
            code: VALIDATION_ERROR
            message: Некорректные данные запроса
            details:
              field: title
              constraint: required

    NotFoundError:
      allOf:
        - $ref: '#/components/schemas/Error'
        - type: object
          properties:
            code:
              type: string
              enum: [NOT_FOUND]
          example:
            code: NOT_FOUND
            message: Ресурс не найден
            details:
              resourceType: resource
              resourceId: a1b2c3d4-e5f6-7890-abcd-ef1234567890

    InternalError:
      allOf:
        - $ref: '#/components/schemas/Error'
        - type: object
          properties:
            code:
              type: string
              enum: [INTERNAL_ERROR]
          example:
            code: INTERNAL_ERROR
            message: Внутренняя ошибка сервера

    # ─────────────────────── Pagination ───────────────────────
    Pagination:
      type: object
      required:
        - offset
        - limit
        - total
      properties:
        offset:
          type: integer
          description: Текущее смещение
        limit:
          type: integer
          description: Максимум записей на страницу
        total:
          type: integer
          description: Общее количество записей
      example:
        offset: 0
        limit: 20
        total: 5
`;

const RESPONSES = `  responses:
    ValidationError:
      description: Ошибка валидации запроса
      headers:
        x-correlation-id:
          schema:
            type: string
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/ValidationError'

    NotFoundError:
      description: Запрашиваемый ресурс не найден
      headers:
        x-correlation-id:
          schema:
            type: string
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/NotFoundError'

    InternalError:
      description: Внутренняя ошибка сервера
      headers:
        x-correlation-id:
          schema:
            type: string
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/InternalError'
`;

// uuid field helper
const uuid = (d) => ({ type: "string", format: "uuid", description: d });
const dt = (d) => ({ type: "string", format: "date-time", description: d });

// Build a schema property block (YAML) from a fields array.
function q(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function propsYaml(fields) {
  // de-duplicate by field name (guard against duplicate keys in generated YAML)
  const seen = new Set();
  const uniq = fields.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });
  return uniq.map((f) => {
    let typeLine;
    if (f.type === "array") {
      typeLine = `          type: array\n          items:\n            type: ${f.items}`;
      if (f.itemsFormat) typeLine += `\n            format: ${f.itemsFormat}`;
    } else {
      typeLine = `          type: ${f.type}`;
      if (f.format) typeLine += `\n          format: ${f.format}`;
    }
    // description always on column 10 (nested inside the property)
    return `        ${f.name}:\n${typeLine}\n          description: ${q(f.desc)}`;
  }).join("\n");
}

// Normalize an example string into a literal-block scalar (indent-independent).
function exampleBlock(s) {
  const lines = s.trim().split("\n").map((l) => l.replace(/^\s+/, ""));
  const body = lines.join("\n          ");
  return `      example:\n        |-\n          ${body}`;
}

// Build a $ref schema for entity with required + properties + example.
function entitySchema(name, desc, fields, example) {
  const required = [...new Set(fields.filter((f) => f.required).map((f) => f.name))];
  const reqBlock = required.length ? `      required:\n${required.map((r) => `        - ${r}`).join("\n")}` : "      required: []";
  return `    ${name}:
      type: object
      description: ${desc}
${reqBlock}
      properties:
${propsYaml(fields)}
${exampleBlock(example)}
`;
}

function refSchema(name, desc, fields, required) {
  const reqBlock = required.length ? `      required:\n${required.map((r) => `        - ${r}`).join("\n")}` : "      required: []";
  return `    ${name}:
      type: object
      description: ${desc}
${reqBlock}
      properties:
${propsYaml(fields)}
`;
}

// Standard CRUD path block for a resource (list/create/get/update/delete).
function crudPaths(resource, Resource, fields, createFields, updateFields, listFilters = []) {
  const listQ = listFilters.length
    ? listFilters.map((f) => `        - name: ${f.name}\n          in: query\n          required: false\n          description: ${f.desc}\n          schema:\n            type: ${f.type}`).join("\n")
    : "";
  return `  /${resource}:
    post:
      operationId: create${Resource}
      summary: Создать ${resource}
      tags: [${Resource}, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/${Resource}Create'
      responses:
        '201':
          description: Создано
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/${Resource}'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

    get:
      operationId: list${Resource}s
      summary: Получить список ${resource}
      tags: [${Resource}, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
${listQ}
      responses:
        '200':
          description: Список с пагинацией
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/${Resource}'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

  /${resource}/{id}:
    get:
      operationId: get${Resource}
      summary: Получить ${resource} по ID
      tags: [${Resource}, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID ${resource}
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Данные
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/${Resource}'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

    patch:
      operationId: update${Resource}
      summary: Обновить ${resource} (частично)
      tags: [${Resource}, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID ${resource}
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/${Resource}Update'
      responses:
        '200':
          description: Обновлено
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/${Resource}'
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

    delete:
      operationId: delete${Resource}
      summary: Удалить ${resource}
      tags: [${Resource}, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID ${resource}
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Удалено (без тела)
          headers:
            x-correlation-id:
              schema:
                type: string
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`;
}

function buildYaml(spec) {
  let head = `openapi: 3.1.0

info:
  title: ${spec.title}
  version: 1.0.0
  description: >
    ${spec.desc}

servers:
  - url: /api/${spec.svc}/v1
    description: API Gateway route for ${spec.svc} service

paths:
${spec.paths}
components:
${PARAMS}  schemas:
${COMMON_SCHEMAS}${spec.schemas}
${RESPONSES}`;
  // Quote summary: values that contain ':' (otherwise YAML breaks).
  head = head.replace(/^(\s*summary:\s*)(.+)$/gm, (m, p, v) => {
    const t = v.trim();
    if (t.startsWith("'") || t.startsWith('"') || t.startsWith(">") || t.startsWith("|")) return m;
    if (t.includes(":")) return `${p}'${t.replace(/'/g, "''")}'`;
    return m;
  });
  return head;
}

// ============================ SERVICE SPECS ============================
const uuidF = (n, d, req = false) => ({ name: n, type: "string", format: "uuid", desc: d, required: req });
const strF = (n, d, req = false) => ({ name: n, type: "string", desc: d, required: req });
const boolF = (n, d, req = false) => ({ name: n, type: "boolean", desc: d, required: req });
const intF = (n, d, req = false) => ({ name: n, type: "integer", desc: d, required: req });
const arrF = (n, items, d, req = false, itemsFormat = null) => ({ name: n, type: "array", items, desc: d, required: req, itemsFormat });
const dtF = (n, d, req = false) => ({ name: n, type: "string", format: "date-time", desc: d, required: req });

const id = uuidF("id", "UUID записи", true);

const SPECS = {};

// 2. settings
SPECS.settings = {
  svc: "settings", title: "Settings Service",
  desc: "Хранилище ключ-значение (Shared Kernel) для настроек приложения, включая модели Ollama.",
  paths: `  /settings:
    post:
      operationId: upsertSetting
      summary: Создать или обновить настройку (upsert)
      tags: [Settings, KV]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SettingUpsert'
      responses:
        '200':
          description: Настройка сохранена
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Setting'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

    get:
      operationId: listSettings
      summary: Получить все настройки
      tags: [Settings, KV]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Список настроек
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Setting'
        '500':
          $ref: '#/components/responses/InternalError'

  /settings/{key}:
    get:
      operationId: getSetting
      summary: Получить настройку по ключу
      tags: [Settings, KV]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: key
          in: path
          required: true
          description: Ключ настройки
          schema:
            type: string
      responses:
        '200':
          description: Значение настройки
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Setting'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

    delete:
      operationId: deleteSetting
      summary: Удалить настройку
      tags: [Settings, KV]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: key
          in: path
          required: true
          description: Ключ настройки
          schema:
            type: string
      responses:
        '204':
          description: Удалено
          headers:
            x-correlation-id:
              schema:
                type: string
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /settings/ollama-models:
    get:
      operationId: listOllamaModels
      summary: Список доступных моделей Ollama
      tags: [Settings, Models]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Список моделей
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      type: string
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Setting", "Ключ-значение настройка", [
    strF("key", "Ключ настройки", true),
    { name: "value", type: "object", desc: "Значение (JSONB, произвольный объект)", required: true },
  ], `        key: gen_model
        value:
          name: qwen2.5-coder
          baseUrl: http://localhost:11434`),
};

// 4. tasks
const taskFields = [
  id,
  strF("title", "Заголовок задачи", true),
  strF("status", "Статус: todo | in_progress | done", true),
  intF("priority", "Приоритет (вес)", true),
  strF("description", "Описание", false),
  strF("assignee", "Исполнитель", false),
  dtF("deadline", "Дедлайн", false),
  uuidF("projectId", "UUID проекта", false),
  arrF("profileIds", "string", "UUID профилей", true, "uuid"),
  strF("recurrence", "Правило рекурренса (RFC5545)", false),
  intF("currentStreak", "Текущая серия выполнений", false),
  intF("bestStreak", "Лучшая серия", false),
  dtF("completedAt", "Время завершения", false),
  boolF("isArchived", "Мягко удалено/в архиве", false),
  dtF("createdAt", "Создано", true),
  dtF("updatedAt", "Обновлено", true),
];
SPECS.tasks = {
  svc: "tasks", title: "Tasks Service",
  desc: "Kanban-задачи с рекурренсом, streaks, зависимостями и ранжированием приоритетов.",
  paths: crudPaths("tasks", "Task", taskFields,
    [strF("title", "Заголовок", true),],
    [strF("title", "Заголовок", false)],
    [{ name: "projectId", type: "string", desc: "Фильтр по проекту (uuid)" }, { name: "status", type: "string", desc: "Фильтр по статусу" }, { name: "profileId", type: "string", desc: "Фильтр по профилю (uuid)" }]
  ) + `  /priorities:
    get:
      operationId: listPriorities
      summary: Ранжированный список приоритетов
      tags: [Priorities]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Приоритеты
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Task'
        '500':
          $ref: '#/components/responses/InternalError'

  /priorities/order:
    put:
      operationId: reorderPriorities
      summary: Переупорядочить приоритеты
      tags: [Priorities]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [orderedIds]
              properties:
                orderedIds:
                  type: array
                  items:
                    type: string
                    format: uuid
      responses:
        '200':
          description: Порядок сохранён
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Task", "Kanban-задача", taskFields, `        id: t1a2b3c4-d5e6-7890-abcd-ef1234567890
        title: Написать документацию
        status: in_progress
        priority: 5
        description: Обновить ADR
        assignee: best
        deadline: '2026-08-01T18:00:00Z'
        projectId: p1a2b3c4-d5e6-7890-abcd-ef1234567890
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]
        recurrence: RRULE:FREQ=DAILY
        currentStreak: 3
        bestStreak: 12
        isArchived: false
        createdAt: '2026-07-30T10:00:00Z'
        updatedAt: '2026-07-30T12:00:00Z'`) +
    refSchema("TaskCreate", "Данные для создания задачи", [
      strF("title", "Заголовок", true),
      intF("priority", "Приоритет", false),
      strF("description", "Описание", false),
      strF("assignee", "Исполнитель", false),
      dtF("deadline", "Дедлайн", false),
      uuidF("projectId", "UUID проекта", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
      strF("recurrence", "Правило рекурренса", false),
    ], ["title"]) +
    refSchema("TaskUpdate", "Частичное обновление задачи (все поля опциональны)", [
      strF("title", "Заголовок", false),
      strF("status", "Статус", false),
      intF("priority", "Приоритет", false),
      strF("description", "Описание", false),
      strF("assignee", "Исполнитель", false),
      dtF("deadline", "Дедлайн", false),
      uuidF("projectId", "UUID проекта", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
      strF("recurrence", "Правило рекурренса", false),
      boolF("isArchived", "В архив", false),
    ], []),
};

// 5. calendar (meetings)
const meetingFields = [
  id,
  strF("title", "Название встречи", true),
  dtF("startTime", "Начало", true),
  dtF("endTime", "Конец", true),
  boolF("allDay", "Весь день", true),
  strF("description", "Описание", false),
  strF("location", "Место", false),
  strF("recurrence", "Правило recurrence", false),
  uuidF("linkedProjectId", "UUID проекта", false),
  arrF("profileIds", "string", "UUID профилей", true, "uuid"),
  uuidF("linkedExternalEventId", "UUID внешнего события", false),
  dtF("createdAt", "Создано", true),
  dtF("updatedAt", "Обновлено", true),
];
SPECS.calendar = {
  svc: "calendar", title: "Calendar Service",
  desc: "Локальный календарь встреч с рекурренсом, напоминаниями и ICS.",
  paths: crudPaths("meetings", "Meeting", meetingFields,
    [strF("title", "Название", true)],
    [strF("title", "Название", false)],
    [{ name: "profileId", type: "string", desc: "Фильтр по профилю (uuid)" }, { name: "from", type: "string", desc: "Начало диапазона (date-time)" }, { name: "to", type: "string", desc: "Конец диапазона (date-time)" }]
  ) + `  /meetings/{id}/ics:
    get:
      operationId: exportMeetingIcs
      summary: Экспорт встречи в ICS
      tags: [Meetings, ICS]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID встречи
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: .ics файл
          content:
            text/calendar:
              schema:
                type: string
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Meeting", "Встреча календаря", meetingFields, `        id: m1a2b3c4-d5e6-7890-abcd-ef1234567890
        title: Standup
        startTime: '2026-07-30T09:00:00Z'
        endTime: '2026-07-30T09:15:00Z'
        allDay: false
        description: Ежедневный standup
        location: Office
        recurrence: RRULE:FREQ=DAILY
        linkedProjectId: p1a2b3c4-d5e6-7890-abcd-ef1234567890
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]
        createdAt: '2026-07-30T08:00:00Z'
        updatedAt: '2026-07-30T08:00:00Z'`) +
    refSchema("MeetingCreate", "Данные для создания встречи", [
      strF("title", "Название", true),
      dtF("startTime", "Начало", true),
      dtF("endTime", "Конец", true),
      boolF("allDay", "Весь день", false),
      strF("description", "Описание", false),
      strF("location", "Место", false),
      strF("recurrence", "Правило recurrence", false),
      uuidF("linkedProjectId", "UUID проекта", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
    ], ["title", "startTime", "endTime"]) +
    refSchema("MeetingUpdate", "Частичное обновление встречи", [
      strF("title", "Название", false),
      dtF("startTime", "Начало", false),
      dtF("endTime", "Конец", false),
      boolF("allDay", "Весь день", false),
      strF("description", "Описание", false),
      strF("location", "Место", false),
      strF("recurrence", "Правило recurrence", false),
      uuidF("linkedProjectId", "UUID проекта", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
    ], []),
};

// 6. projects
const projectFields = [
  id,
  strF("name", "Название проекта", true),
  strF("description", "Описание", false),
  strF("goal", "Цель", false),
  strF("status", "Статус: active | archived | completed", true),
  arrF("profileIds", "string", "UUID профилей", true, "uuid"),
  dtF("createdAt", "Создано", true),
  dtF("updatedAt", "Обновлено", true),
];
SPECS.projects = {
  svc: "projects", title: "Projects Service",
  desc: "Группировка заметок, задач, встреч и файлов в проекты с Gantt-диаграммой.",
  paths: crudPaths("projects", "Project", projectFields,
    [strF("name", "Название", true)],
    [strF("name", "Название", false)],
    []
  ) + `  /projects/{id}/items:
    get:
      operationId: getProjectItems
      summary: Элементы проекта (notes, tasks, meetings, files)
      tags: [Projects, Dashboard]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID проекта
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Элементы проекта
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [notes, tasks, meetings, files]
                properties:
                  notes:
                    type: array
                    items:
                      type: object
                  tasks:
                    type: array
                    items:
                      type: object
                  meetings:
                    type: array
                    items:
                      type: object
                  files:
                    type: array
                    items:
                      type: object
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /projects/{id}/gantt:
    get:
      operationId: getProjectGantt
      summary: Gantt-диаграмма проекта
      tags: [Projects, Gantt]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID проекта
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Задачи с датами и зависимостями
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [tasks]
                properties:
                  tasks:
                    type: array
                    items:
                      type: object
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Project", "Проект", projectFields, `        id: p1a2b3c4-d5e6-7890-abcd-ef1234567890
        name: Ребрендинг
        description: Полный ребрендинг продукта
        goal: Запустить новый бренд к Q4
        status: active
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]
        createdAt: '2026-07-01T10:00:00Z'
        updatedAt: '2026-07-30T12:00:00Z'`) +
    refSchema("ProjectCreate", "Данные для создания проекта", [
      strF("name", "Название", true),
      strF("description", "Описание", false),
      strF("goal", "Цель", false),
      strF("status", "Статус", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
    ], ["name"]) +
    refSchema("ProjectUpdate", "Частичное обновление проекта", [
      strF("name", "Название", false),
      strF("description", "Описание", false),
      strF("goal", "Цель", false),
      strF("status", "Статус", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
    ], []),
};

// 7. files
const fileFields = [
  id,
  strF("filename", "Имя файла", true),
  strF("mimeType", "MIME-тип", true),
  intF("size", "Размер в байтах", true),
  strF("ownerType", "Тип владельца (note|task|project|null)", false),
  uuidF("ownerId", "UUID владельца", false),
  strF("storagePath", "Путь в хранилище", true),
  arrF("profileIds", "string", "UUID профилей", true, "uuid"),
  dtF("uploadedAt", "Загружено", true),
];
SPECS.files = {
  svc: "files", title: "Files Service",
  desc: "Загрузка, хранение, извлечение текста и семантическая индексация файлов.",
  paths: `  /files:
    get:
      operationId: listFiles
      summary: Список файлов
      tags: [Files, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
        - name: profileId
          in: query
          required: false
          description: Фильтр по профилю (uuid)
          schema:
            type: string
            format: uuid
        - name: ownerType
          in: query
          required: false
          description: Тип владельца
          schema:
            type: string
      responses:
        '200':
          description: Список с пагинацией
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/FileMeta'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

    post:
      operationId: uploadFile
      summary: Загрузить файл (multipart, лимит 50MB)
      tags: [Files, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
                profileIds:
                  type: array
                  items:
                    type: string
                    format: uuid
                ownerType:
                  type: string
                ownerId:
                  type: string
                  format: uuid
      responses:
        '201':
          description: Файл загружен
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/FileMeta'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

  /files/{id}:
    get:
      operationId: getFile
      summary: Метаданные файла
      tags: [Files, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID файла
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Метаданные
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/FileMeta'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

    delete:
      operationId: deleteFile
      summary: Удалить файл
      tags: [Files, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID файла
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Удалено
          headers:
            x-correlation-id:
              schema:
                type: string
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /files/{id}/download:
    get:
      operationId: downloadFile
      summary: Скачать файл
      tags: [Files, Download]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID файла
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Бинарный контент файла
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("FileMeta", "Метаданные файла", fileFields, `        id: f1a2b3c4-d5e6-7890-abcd-ef1234567890
        filename: report.pdf
        mimeType: application/pdf
        size: 1048576
        ownerType: project
        ownerId: p1a2b3c4-d5e6-7890-abcd-ef1234567890
        storagePath: /storage/f1a2b3c4/report.pdf
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]
        uploadedAt: '2026-07-30T10:00:00Z'`),
};

// 8. search-rag
SPECS["search-rag"] = {
  svc: "search-rag", title: "Search & RAG Service",
  desc: "Полнотекстовый (ILIKE) и семантический (embedding) поиск по всем сущностям с graceful degradation.",
  paths: `  /search:
    post:
      operationId: search
      summary: Поиск по всем сущностям
      tags: [Search]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SearchQuery'
      responses:
        '200':
          description: Результаты поиска
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResult'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: refSchema("SearchQuery", "Запрос поиска", [
    strF("query", "Поисковый запрос", true),
    strF("type", "Фильтр типа: note|task|meeting|file", false),
    arrF("tags", "string", "Tags filter", false),
    uuidF("projectId", "Фильтр проекта", false),
    arrF("profileIds", "string", "Фильтр профилей", false, "uuid"),
    intF("limit", "Лимит результатов", false),
  ], ["query"]) +
    entitySchema("SearchResult", "Результаты поиска", [
      { name: "results", type: "array", items: "object", desc: "Найденные сущности", required: true },
      { name: "semantic", type: "boolean", desc: "Использован ли embedding-поиск", required: true },
      intF("total", "Всего найдено", false),
    ], `        results:
          - id: n1a2b3c4-d5e6-7890-abcd-ef1234567890
            type: note
            title: Купить молоко
            snippet: Нужно купить молоко...
        semantic: true
        total: 1`),
};

// 9. ai-gateway
SPECS["ai-gateway"] = {
  svc: "ai-gateway", title: "AI Gateway Service",
  desc: "Единый прокси к LLM с fallback chain (Ollama локально, cloud опционально).",
  paths: `  /restore-punctuation:
    post:
      operationId: restorePunctuation
      summary: Восстановить пунктуацию в тексте
      tags: [AI, Punctuation]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AiTextRequest'
      responses:
        '200':
          description: Обработанный текст
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/AiTextResponse'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

  /dictate:
    post:
      operationId: dictate
      summary: Диктовка: текст → структурированное тело+заголовок+тег
      tags: [AI, Dictation]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AiTextRequest'
      responses:
        '200':
          description: Результат диктовки
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DictationResult'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: refSchema("AiTextRequest", "Текстовый запрос к LLM", [
    strF("text", "Входной текст", true),
    strF("model", "Модель (опционально, иначе fallback)", false),
  ], ["text"]) +
    refSchema("AiTextResponse", "Ответ LLM", [
      strF("text", "Обработанный текст", true),
    ], ["text"]) +
    entitySchema("DictationResult", "Результат диктовки", [
      strF("title", "Заголовок", true),
      strF("bodyMd", "Тело в Markdown", true),
      strF("tag", "Предложенный тег", false),
    ], `        title: Купить молоко
        bodyMd: Нужно купить молоко и хлеб
        tag: shopping`),
};

// 10. agent
const agentFields = [
  id,
  strF("title", "Заголовок сообщения", true),
  strF("body", "Тело сообщения", true),
  strF("type", "Тип: digest|trigger|suggestion", true),
  strF("source", "Источник (событие)", false),
  strF("status", "Статус: pending|accepted|dismissed", true),
  { name: "actions", type: "array", items: "object", desc: "Предлагаемые действия", required: false },
  dtF("createdAt", "Создано", true),
];
SPECS.agent = {
  svc: "agent", title: "Agent Service",
  desc: "AI-ассистент: автоматические триггеры, дайджесты, инбокс с suggested actions.",
  paths: `  /agent/inbox:
    get:
      operationId: getInbox
      summary: Список сообщений инбокса
      tags: [Agent, Inbox]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
        - name: status
          in: query
          required: false
          description: Фильтр по статусу
          schema:
            type: string
      responses:
        '200':
          description: Сообщения
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/AgentMessage'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

  /agent/respond:
    post:
      operationId: respondToMessage
      summary: Принять/отклонить/ответить на сообщение
      tags: [Agent, Inbox]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AgentResponse'
      responses:
        '200':
          description: Обработано
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
        '400':
          $ref: '#/components/responses/ValidationError'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /agent/dismiss-all:
    post:
      operationId: dismissAll
      summary: Отклонить все сообщения
      tags: [Agent, Inbox]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Отклонено
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  dismissed:
                    type: integer
        '500':
          $ref: '#/components/responses/InternalError'

  /today:
    get:
      operationId: getTodayDigest
      summary: Дайджест на сегодня
      tags: [Agent, Digest]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Дайджест
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  meetings:
                    type: array
                    items:
                      type: object
                  tasks:
                    type: array
                    items:
                      type: object
                  messages:
                    type: array
                    items:
                      type: object
        '500':
          $ref: '#/components/responses/InternalError'

  /week:
    get:
      operationId: getWeekDigest
      summary: Дайджест на неделю
      tags: [Agent, Digest]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Дайджест
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  meetings:
                    type: array
                    items:
                      type: object
                  tasks:
                    type: array
                    items:
                      type: object
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("AgentMessage", "Сообщение агента", agentFields, `        id: a1b2c3c4-d5e6-7890-abcd-ef1234567890
        title: Напоминание о дедлайне
        body: Задача "Написать документацию" закрывается через 2 часа
        type: trigger
        source: tasks.status_changed
        status: pending
        actions:
          - id: snooze
            label: Отложить
        createdAt: '2026-07-30T16:00:00Z'`) +
    refSchema("AgentResponse", "Ответ на сообщение агента", [
      uuidF("messageId", "UUID сообщения", true),
      strF("action", "accept|reject|reply", true),
      strF("reply", "Текст ответа (если reply)", false),
    ], ["messageId", "action"]),
};

// 11. email
const emailAcctFields = [
  id,
  strF("host", "IMAP хост", true),
  intF("port", "IMAP порт", true),
  boolF("ssl", "SSL", true),
  strF("username", "Логин", true),
  strF("encryptedPassword", "Зашифрованный пароль", true),
  boolF("syncEnabled", "Синхронизация включена", false),
  dtF("lastSyncAt", "Последняя синхронизация", false),
  arrF("profileIds", "string", "UUID профилей", false, "uuid"),
];
SPECS.email = {
  svc: "email", title: "Email (IMAP) Service",
  desc: "Подключение email-аккаунтов по IMAP, синхронизация писем, конвертация в заметки/задачи.",
  paths: crudPaths("imap", "ImapAccount", emailAcctFields,
    [strF("host", "Хост", true)],
    [strF("host", "Хост", false)],
    []
  ) + `  /imap/{id}/sync:
    post:
      operationId: syncImapAccount
      summary: Синхронизировать письма аккаунта
      tags: [Email, Sync]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID аккаунта
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Синхронизация запущена/завершена
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  synced:
                    type: integer
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /imap/emails:
    get:
      operationId: listEmails
      summary: Список писем
      tags: [Email, Emails]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
        - name: accountId
          in: query
          required: false
          description: Фильтр по аккаунту (uuid)
          schema:
            type: string
            format: uuid
        - name: isArchived
          in: query
          required: false
          description: Фильтр по архиву
          schema:
            type: boolean
      responses:
        '200':
          description: Письма
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      type: object
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

    patch:
      operationId: updateEmail
      summary: Обновить письмо (архив/конвертация)
      tags: [Email, Emails]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                id:
                  type: string
                  format: uuid
                isArchived:
                  type: boolean
                convertTo:
                  type: string
                  enum: [note, task]
      responses:
        '200':
          description: Обновлено
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("ImapAccount", "IMAP аккаунт", emailAcctFields, `        id: e1a2b3c4-d5e6-7890-abcd-ef1234567890
        host: imap.gmail.com
        port: 993
        ssl: true
        username: user@gmail.com
        encryptedPassword: enc:xxxx
        syncEnabled: true
        lastSyncAt: '2026-07-30T09:00:00Z'
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]`),
};

// 12. external-calendars
const extCalFields = [
  id,
  strF("displayName", "Отображаемое имя", true),
  strF("provider", "Провайдер: google|yandex|ics", true),
  strF("syncEnabled", "Синхронизация включена", false),
  strF("authData", "Данные авторизации (token/url)", false),
  dtF("lastSyncAt", "Последняя синхронизация", false),
];
SPECS["external-calendars"] = {
  svc: "external-calendars", title: "External Calendars Service",
  desc: "Синхронизация с Google Calendar, Yandex Calendar и ICS URLs.",
  paths: crudPaths("calendars", "ExternalCalendar", extCalFields,
    [strF("displayName", "Имя", true), strF("provider", "Провайдер", true)],
    [strF("displayName", "Имя", false)],
    []
  ) + `  /calendars/sync/{id}:
    post:
      operationId: syncExternalCalendar
      summary: Синхронизировать внешний календарь
      tags: [ExternalCalendars, Sync]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID календаря
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Синхронизация выполнена
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  syncedEvents:
                    type: integer
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /calendars/{id}/events:
    get:
      operationId: listExternalEvents
      summary: События внешнего календаря
      tags: [ExternalCalendars, Events]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID календаря
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: События
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      type: object
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'

  /calendars/events/{id}/link:
    patch:
      operationId: linkExternalEvent
      summary: Связать внешнее событие с локальной встречей
      tags: [ExternalCalendars, Events]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID внешнего события
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                meetingId:
                  type: string
                  format: uuid
      responses:
        '200':
          description: Связано
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok:
                    type: boolean
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("ExternalCalendar", "Внешний календарь", extCalFields, `        id: c1a2b3c4-d5e6-7890-abcd-ef1234567890
        displayName: Work Calendar
        provider: google
        syncEnabled: true
        lastSyncAt: '2026-07-30T09:00:00Z'`) +
    refSchema("ExternalCalendarCreate", "Данные для создания внешнего календаря", [
      strF("displayName", "Имя", true),
      strF("provider", "Провайдер", true),
      strF("authData", "Данные авторизации", false),
      boolF("syncEnabled", "Синхронизация", false),
    ], ["displayName", "provider"]) +
    refSchema("ExternalCalendarUpdate", "Частичное обновление", [
      strF("displayName", "Имя", false),
      strF("authData", "Данные авторизации", false),
      boolF("syncEnabled", "Синхронизация", false),
    ], []),
};

// 13. integrations
const apiKeyFields = [
  id,
  strF("name", "Название ключа", true),
  strF("keyHash", "SHA256 хеш ключа (только чтение)", false),
  boolF("active", "Активен", false),
  dtF("createdAt", "Создан", true),
];
const webhookFields = [
  id,
  strF("url", "URL для доставки", true),
  arrF("events", "string", "Подписки на события", true),
  strF("secret", "Секрет для подписи", false),
  boolF("active", "Активен", false),
  dtF("createdAt", "Создан", true),
];
SPECS.integrations = {
  svc: "integrations", title: "Integrations Service",
  desc: "Публичный API (v1), webhook-уведомления и API-ключи для внешних интеграций.",
  paths: crudPaths("webhooks", "Webhook", webhookFields,
    [strF("url", "URL", true), arrF("events", "string", "События", true)],
    [strF("url", "URL", false)],
    []
  ).replace(/\/webhooks:/g, "/webhooks:") + `  /webhooks/{id}/deliveries:
    get:
      operationId: listWebhookDeliveries
      summary: История доставок webhook
      tags: [Webhooks, Deliveries]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
        - name: id
          in: path
          required: true
          description: UUID webhook
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: Доставки
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      type: object
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

  /api-keys:
    get:
      operationId: listApiKeys
      summary: Список API-ключей
      tags: [ApiKeys, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      responses:
        '200':
          description: Ключи
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/ApiKey'
        '500':
          $ref: '#/components/responses/InternalError'

    post:
      operationId: createApiKey
      summary: Создать API-ключ
      tags: [ApiKeys, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ApiKeyCreate'
      responses:
        '201':
          description: Ключ создан (в ответе — plaintext, только здесь)
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ApiKey'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

  /api-keys/{id}:
    delete:
      operationId: deleteApiKey
      summary: Удалить API-ключ
      tags: [ApiKeys, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID ключа
          schema:
            type: string
            format: uuid
      responses:
        '204':
          description: Удалён
          headers:
            x-correlation-id:
              schema:
                type: string
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Webhook", "Webhook-подписка", webhookFields, `        id: w1a2b3c4-d5e6-7890-abcd-ef1234567890
        url: https://example.com/hook
        events: [notes.created, tasks.updated]
        active: true
        createdAt: '2026-07-30T10:00:00Z'`) +
    refSchema("WebhookCreate", "Данные для создания webhook", [
      strF("url", "URL", true),
      arrF("events", "string", "События", true),
      strF("secret", "Секрет", false),
    ], ["url", "events"]) +
    refSchema("WebhookUpdate", "Частичное обновление webhook", [
      strF("url", "URL", false),
      arrF("events", "string", "События", false),
      boolF("active", "Активен", false),
    ], []) +
    entitySchema("ApiKey", "API-ключ", apiKeyFields, `        id: k1a2b3c4-d5e6-7890-abcd-ef1234567890
        name: Zapier
        keyHash: sha256:abc123
        active: true
        createdAt: '2026-07-30T10:00:00Z'`) +
    refSchema("ApiKeyCreate", "Данные для создания API-ключа", [
      strF("name", "Название", true),
    ], ["name"]),
};

// 14. time-tracking
const timesheetFields = [
  id,
  uuidF("taskId", "UUID задачи", false),
  strF("description", "Описание записи", false),
  dtF("startedAt", "Начало", true),
  dtF("endedAt", "Конец", false),
  intF("durationSec", "Длительность в секундах", false),
  arrF("profileIds", "string", "UUID профилей", false, "uuid"),
];
const pomodoroFields = [
  id,
  strF("mode", "Режим: pomodoro|flowtime|countdown", true),
  dtF("startedAt", "Начало", true),
  dtF("endedAt", "Конец", false),
  intF("plannedMin", "Плановые минуты", false),
  boolF("completed", "Завершён", false),
  uuidF("taskId", "UUID задачи", false),
];
SPECS["time-tracking"] = {
  svc: "time-tracking", title: "Time Tracking Service",
  desc: "Учёт времени: timesheet (лог) и pomodoro (сессии).",
  paths: crudPaths("timesheet", "Timesheet", timesheetFields,
    [dtF("startedAt", "Начало", true)],
    [dtF("startedAt", "Начало", false)],
    [{ name: "taskId", type: "string", desc: "Фильтр по задаче (uuid)" }, { name: "from", type: "string", desc: "Начало диапазона" }, { name: "to", type: "string", desc: "Конец диапазона" }]
  ) + `  /timesheet/stats:
    get:
      operationId: getTimesheetStats
      summary: Статистика времени
      tags: [Timesheet, Stats]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: from
          in: query
          required: false
          description: Начало диапазона (date-time)
          schema:
            type: string
            format: date-time
        - name: to
          in: query
          required: false
          description: Конец диапазона (date-time)
          schema:
            type: string
            format: date-time
      responses:
        '200':
          description: Статистика
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  todayTotal:
                    type: integer
                  weekTotal:
                    type: integer
                  byTask:
                    type: array
                    items:
                      type: object
                  byProject:
                    type: array
                    items:
                      type: object
        '500':
          $ref: '#/components/responses/InternalError'

  /pomodoro:
    get:
      operationId: listPomodoro
      summary: Список pomodoro-сессий
      tags: [Pomodoro, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - $ref: '#/components/parameters/Offset'
        - $ref: '#/components/parameters/Limit'
      responses:
        '200':
          description: Сессии
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                required: [data, pagination]
                properties:
                  data:
                    type: array
                    items:
                      $ref: '#/components/schemas/Pomodoro'
                  pagination:
                    $ref: '#/components/schemas/Pagination'
        '500':
          $ref: '#/components/responses/InternalError'

    post:
      operationId: startPomodoro
      summary: Начать pomodoro-сессию
      tags: [Pomodoro, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PomodoroCreate'
      responses:
        '201':
          description: Сессия начата
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pomodoro'
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'

  /pomodoro/{id}:
    patch:
      operationId: updatePomodoro
      summary: Завершить/обновить pomodoro-сессию
      tags: [Pomodoro, CRUD]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: id
          in: path
          required: true
          description: UUID сессии
          schema:
            type: string
            format: uuid
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PomodoroUpdate'
      responses:
        '200':
          description: Обновлено
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pomodoro'
        '404':
          $ref: '#/components/responses/NotFoundError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: entitySchema("Timesheet", "Запись времени", timesheetFields, `        id: t1a2b3c4-d5e6-7890-abcd-ef1234567890
        taskId: t1a2b3c4-d5e6-7890-abcd-ef1234567890
        description: Работа над документацией
        startedAt: '2026-07-30T10:00:00Z'
        endedAt: '2026-07-30T11:30:00Z'
        durationSec: 5400
        profileIds: [f1a2b3c4-d5e6-7890-abcd-ef1234567890]`) +
    refSchema("TimesheetCreate", "Данные для записи времени", [
      uuidF("taskId", "UUID задачи", false),
      strF("description", "Описание", false),
      dtF("startedAt", "Начало", true),
      dtF("endedAt", "Конец", false),
      intF("durationSec", "Длительность", false),
      arrF("profileIds", "string", "UUID профилей", false, "uuid"),
    ], ["startedAt"]) +
    refSchema("TimesheetUpdate", "Частичное обновление записи", [
      dtF("endedAt", "Конец", false),
      intF("durationSec", "Длительность", false),
    ], []) +
    entitySchema("Pomodoro", "Pomodoro-сессия", pomodoroFields, `        id: p1a2b3c4-d5e6-7890-abcd-ef1234567890
        mode: pomodoro
        startedAt: '2026-07-30T10:00:00Z'
        endedAt: '2026-07-30T10:25:00Z'
        plannedMin: 25
        completed: true
        taskId: t1a2b3c4-d5e6-7890-abcd-ef1234567890`) +
    refSchema("PomodoroCreate", "Данные для старта сессии", [
      strF("mode", "Режим", true),
      intF("plannedMin", "Плановые минуты", false),
      uuidF("taskId", "UUID задачи", false),
    ], ["mode"]) +
    refSchema("PomodoroUpdate", "Обновление сессии", [
      dtF("endedAt", "Конец", false),
      boolF("completed", "Завершён", false),
    ], []),
};

// 15. export-import
SPECS["export-import"] = {
  svc: "export-import", title: "Export & Import Service",
  desc: "Полный экспорт всех данных (ZIP) и импорт из текста/JSON.",
  paths: `  /export:
    get:
      operationId: exportAll
      summary: Экспорт всех данных в ZIP
      tags: [Export]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
        - name: format
          in: query
          required: false
          description: Формат (zip|json)
          schema:
            type: string
            enum: [zip, json]
            default: zip
      responses:
        '200':
          description: Архив с данными
          content:
            application/zip:
              schema:
                type: string
                format: binary
        '500':
          $ref: '#/components/responses/InternalError'

  /import:
    post:
      operationId: importData
      summary: Импорт данных из текста или JSON
      tags: [Import]
      parameters:
        - $ref: '#/components/parameters/CorrelationId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ImportRequest'
      responses:
        '200':
          description: Импорт выполнен
          headers:
            x-correlation-id:
              schema:
                type: string
          content:
            application/json:
              schema:
                type: object
                properties:
                  importedNotes:
                    type: integer
                  importedTasks:
                    type: integer
                  importedCalendars:
                    type: integer
        '400':
          $ref: '#/components/responses/ValidationError'
        '500':
          $ref: '#/components/responses/InternalError'
`,
  schemas: refSchema("ImportRequest", "Запрос импорта", [
    strF("format", "Формат: text|json", true),
    strF("content", "Содержимое для импорта", true),
    strF("target", "Цель: note|task|calendar", false),
  ], ["format", "content"]),
};

// 16. sync
const syncFolderFields = [
  id,
  strF("path", "Путь к папке на диске", true),
  boolF("autoImport", "Автоимпорт .md → заметки", false),
  boolF("autoExport", "Автоэкспорт заметок → .md", false),
  strF("profileScope", "Какие профили синхронизировать (json)", false),
  dtF("lastScanAt", "Последнее сканирование", false),
];
SPECS.sync = {
  svc: "sync", title: "Sync Folders Service",
  desc: "Obsidian-style синхронизация с файловой системой (auto import/export).",
  paths: crudPaths("sync-folders", "SyncFolder", syncFolderFields,
    [strF("path", "Путь", true)],
    [strF("path", "Путь", false)],
    []
  ),
  schemas: entitySchema("SyncFolder", "Папка синхронизации", syncFolderFields, `        id: s1a2b3c4-d5e6-7890-abcd-ef1234567890
        path: /Users/me/Documents/notes
        autoImport: true
        autoExport: true
        profileScope: '["home"]'
        lastScanAt: '2026-07-30T09:00:00Z'`) +
    refSchema("SyncFolderCreate", "Данные для создания папки синхронизации", [
      strF("path", "Путь", true),
      boolF("autoImport", "Автоимпорт", false),
      boolF("autoExport", "Автоэкспорт", false),
      strF("profileScope", "Профили", false),
    ], ["path"]) +
    refSchema("SyncFolderUpdate", "Частичное обновление папки", [
      strF("path", "Путь", false),
      boolF("autoImport", "Автоимпорт", false),
      boolF("autoExport", "Автоэкспорт", false),
      strF("profileScope", "Профили", false),
    ], []),
};

// ============================ WRITE FILES ============================
mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [name, spec] of Object.entries(SPECS)) {
  const yaml = buildYaml(spec);
  writeFileSync(join(OUT, `${name}.yaml`), yaml);
  count++;
}
console.log(`Generated ${count} OpenAPI contracts under contracts/openapi/`);
