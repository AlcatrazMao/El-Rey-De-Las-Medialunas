import type { ApiClientOptions, ApiResponse, RequestOptions } from "./types";
import { ApiError } from "./types";

const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 1000;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export class ApiClient {
  private baseUrl: string;
  private getToken: () => string | null | Promise<string | null>;
  private onUnauthorized?: () => void | Promise<void>;
  private retries: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
    this.retries = options.retries ?? DEFAULT_RETRIES;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/+$/, "");
  }

  private async buildHeaders(): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const token = await this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return headers;
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let body: Partial<ApiResponse<never>> | undefined;
      try {
        body = (await response.json()) as ApiResponse<never>;
      } catch {
        body = undefined;
      }

      const errorCode = body?.error?.code ?? `HTTP_${response.status}`;
      const errorMessage = body?.error?.message ?? response.statusText;
      const errorDetails = body?.error?.details ?? undefined;

      if (response.status === 401 && this.onUnauthorized) {
        await this.onUnauthorized();
      }

      throw new ApiError(errorCode, errorMessage, response.status, errorDetails);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const responseBody = (await response.json()) as T;
    return responseBody;
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    let lastError: Error | null = null;
    const maxAttempts = this.retries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const headers = await this.buildHeaders();
        const url = this.buildUrl(path, options?.params);

        const fetchOptions: RequestInit = {
          method,
          headers,
          signal: options?.signal,
        };

        if (body !== undefined && method !== "GET") {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        return await this.handleResponse<T>(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof ApiError) {
          throw error;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }

        const isNetworkError =
          error instanceof TypeError ||
          (error instanceof Error &&
            (error.message.includes("Failed to fetch") ||
              error.message.includes("NetworkError") ||
              error.message.includes("Network request failed")));

        if (!isNetworkError || attempt >= maxAttempts - 1) {
          throw new Error(
            `Request failed after ${attempt + 1} attempt(s): ${lastError.message}`,
          );
        }

        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Request failed: ${lastError?.message ?? "Unknown error"}`);
  }

  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  async post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  async put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, body, options);
  }

  async delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  async upload<T>(path: string, formData: FormData, options?: RequestOptions): Promise<T> {
    const url = this.buildUrl(path, options?.params);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    const token = await this.getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const fetchOptions: RequestInit = {
      method: "POST",
      headers,
      body: formData,
      signal: options?.signal,
    };

    const response = await fetch(url, fetchOptions);
    return this.handleResponse<T>(response);
  }
}
