import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { jwtDecode } from 'jwt-decode';

interface Credentials {
  email: string;
  password: string;
}

interface AuthTokens {
  token: string;
  refreshToken?: string;
}

interface JWTPayload {
  id: string;
  email: string;
  roles: string[];
  exp: number;
}

interface User {
  id: string;
  email: string;
  roles: string[];
}

// Generic error type for API errors
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthApiClient {
  private axiosInstance: AxiosInstance;
  private credentials: Credentials;
  private tokens: AuthTokens | null = null;
  private tokenRefreshPromise: Promise<void> | null = null;
  private readonly TOKEN_REFRESH_THRESHOLD = 60; // 1 minute in seconds

  constructor(baseURL: string, credentials: Credentials) {
    this.credentials = credentials;
    this.axiosInstance = axios.create({
      baseURL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to handle token management
    this.axiosInstance.interceptors.request.use(
      async config => {
        // Skip authentication for login and register endpoints
        if (
          config.url?.endsWith('/auth/login') ||
          config.url?.endsWith('/register')
        ) {
          return config;
        }

        const token = await this.getValidToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      error => Promise.reject(error),
    );
  }

  private async getValidToken(): Promise<string | null> {
    if (!this.tokens?.token) {
      await this.login();
      return this.tokens?.token || null;
    }

    const decodedToken = jwtDecode<JWTPayload>(this.tokens.token);
    const expiresIn = decodedToken.exp - Math.floor(Date.now() / 1000);

    if (expiresIn <= this.TOKEN_REFRESH_THRESHOLD) {
      await this.refreshToken();
    }

    return this.tokens?.token || null;
  }

  private async login(): Promise<void> {
    try {
      const response = await this.axiosInstance.post<AuthTokens>(
        '/auth/login',
        this.credentials,
      );
      this.tokens = response.data;
    } catch (error) {
      throw new Error('Failed to login');
    }
  }

  private async refreshToken(): Promise<void> {
    // If a refresh is already in progress, wait for it
    if (this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
      return;
    }

    this.tokenRefreshPromise = (async () => {
      try {
        if (!this.tokens?.refreshToken) {
          await this.login();
          return;
        }

        const response = await this.axiosInstance.post<AuthTokens>(
          '/auth/token',
          {
            refreshToken: this.tokens.refreshToken,
          },
        );

        this.tokens = {
          ...this.tokens,
          token: response.data.token,
        };
      } catch (error) {
        // If refresh fails, try logging in again
        this.tokens = null;
        await this.login();
      } finally {
        this.tokenRefreshPromise = null;
      }
    })();

    await this.tokenRefreshPromise;
  }

  // Base HTTP methods with proper typing
  public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.get<T>(url, config);
    return response.data;
  }

  public async post<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.axiosInstance.post<T>(url, data, config);
    return response.data;
  }

  public async put<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.axiosInstance.put<T>(url, data, config);
    return response.data;
  }

  public async patch<T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    const response = await this.axiosInstance.patch<T>(url, data, config);
    return response.data;
  }

  public async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.axiosInstance.delete<T>(url, config);
    return response.data;
  }
}
