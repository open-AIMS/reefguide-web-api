/**
 * Base class for all custom API exceptions.
 * Extends the built-in Error class and adds a status code property.
 */
export class BaseApiException extends Error {
  statusCode: number;

  constructor(
    message: string = "An unexpected error occurred",
    statusCode: number = 500
  ) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Exception for resource not found errors (HTTP 404).
 */
export class NotFoundException extends BaseApiException {
  constructor(message: string = "Resource not found") {
    super(message, 404);
  }
}

/**
 * Exception for internal server errors (HTTP 500).
 */
export class InternalServerError extends BaseApiException {
  constructor(message: string = "Internal server error") {
    super(message, 500);
  }
}

/**
 * Exception for bad request errors (HTTP 400).
 */
export class BadRequestException extends BaseApiException {
  constructor(message: string = "Bad request") {
    super(message, 400);
  }
}

/**
 * Exception for unauthorized access errors (HTTP 401).
 */
export class UnauthorizedException extends BaseApiException {
  constructor(message: string = "Unauthorized") {
    super(message, 401);
  }
}

/**
 * Exception for forbidden access errors (HTTP 401).
 */
export class ForbiddenException extends BaseApiException {
  constructor(message: string = "Forbidden") {
    super(message, 401);
  }
}
