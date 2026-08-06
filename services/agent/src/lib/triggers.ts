/**
 * Pure trigger evaluators for the agent. Each returns the messages to create
 * (or an empty array when nothing fires). Deterministic and unit-testable —
 * no DB, no NATS, no clock (time is injected where needed).
 */

export interface TaskTriggerContext {
  title: string;
  deadline?: string | null;
  assigneeId?: string | null;
  assignee?: string | null;
  newStatus?: string;
  /** epoch ms — injectable for tests; defaults to Date.now() */
  now?: number;
}

export interface TriggerMessage {
  type: "trigger" | "suggestion";
  source: string;
  title: string;
  body: string;
}

/**
 * Evaluate the task-status triggers (deadline_soon, task_no_assignee).
 * Preserves the exact legacy behaviour:
 *  - deadline_soon: fires when 0 <= (deadline - now)/3.6e6 <= 24, rounded to
 *    max(1, round(hours)) hours.
 *  - task_no_assignee: fires when neither assigneeId nor assignee is set.
 */
export function evaluateTaskTriggers(ctx: TaskTriggerContext): TriggerMessage[] {
  const messages: TriggerMessage[] = [];
  const now = ctx.now ?? Date.now();

  if (ctx.newStatus !== "done" && ctx.deadline) {
    const hours = (new Date(ctx.deadline).getTime() - now) / 3_600_000;
    if (hours >= 0 && hours <= 24) {
      const rounded = Math.max(1, Math.round(hours));
      messages.push({
        type: "trigger",
        source: "deadline_soon",
        title: `Дедлайн задачи «${ctx.title}»`,
        body: `Дедлайн задачи «${ctx.title}» через ${rounded} ч`,
      });
    }
  }

  const assignee = ctx.assigneeId ?? ctx.assignee;
  if (!assignee) {
    messages.push({
      type: "suggestion",
      source: "task_no_assignee",
      title: "Задача без исполнителя",
      body: `Задача «${ctx.title}» без назначенного исполнителя`,
    });
  }

  return messages;
}

/** True when a meeting's end time has passed (or is missing → false). */
export function meetingEndedDue(endTime: string | null | undefined, now: number): boolean {
  if (!endTime) return false;
  const t = new Date(endTime).getTime();
  if (Number.isNaN(t)) return false;
  return t <= now;
}

/** Deterministic offline plan outline derived from a project goal (no LLM). */
export function buildProjectPlanBody(goal: string): string {
  const steps = [
    "1) Уточнить цель и критерии успеха",
    "2) Разбить работу на этапы и задачи",
    "3) Оценить ресурсы и сроки",
    "4) Назначить исполнителей и контрольные точки",
    "5) Регулярно отслеживать прогресс и корректировать план",
  ];
  return `План по цели: ${goal}\n${steps.join("\n")}`;
}