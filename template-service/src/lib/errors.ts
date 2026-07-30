/**
 * Типизированные классы ошибок для сервисов ЦУП.
 *
 * Все ошибки сериализуются в JSON через toJSON() для Fastify error handler.
 */

export interface SerializedError {
  error: {
    code: string;
    message: string;
    correlationId?: string | undefined;
  };
}

export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: string;
  public correlationId?: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON(): SerializedError {
    return {
      error: {
        code: this.code,
        message: this.message,
        correlationId: this.correlationId,
      },
    };
  }
}

export class ValidationError extends AppError {
  public override readonly statusCode = 400;
  public override readonly code = "VALIDATION_ERROR";
}

export class NotFoundError extends AppError {
  public override readonly statusCode = 404;
  public override readonly code = "NOT_FOUND";
}

export class ConflictError extends AppError {
  public override readonly statusCode = 409;
  public override readonly code = "CONFLICT";
}

export class InternalError extends AppError {
  public override readonly statusCode = 500;
  public override readonly code = "INTERNAL_ERROR";
}
