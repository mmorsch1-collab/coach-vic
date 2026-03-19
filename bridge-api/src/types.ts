// Common API response types
export interface SuccessResponse<T = any> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: any;
  };
}

export type ApiResponse<T = any> = SuccessResponse<T> | ErrorResponse;

// Health check response
export interface HealthCheckResponse {
  ok: boolean;
  timestamp: string;
  uptime: number;
}
