import type {
  LoginRequest,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  ValidateTokenRequest,
  ValidateTokenResponse,
  User,
} from "@medialunas/shared/types/api";

import type { ApiClient } from "../client";

export class AuthEndpoints {
  constructor(private client: ApiClient) {}

  async login(idToken: string, branchId: string): Promise<LoginResponse> {
    const body: LoginRequest = { id_token: idToken, branch_id: branchId };
    return this.client.post<LoginResponse>("/api/v1/auth/login", body);
  }

  async loginWithGoogle(idToken: string): Promise<LoginResponse> {
    const body: LoginRequest = { id_token: idToken, branch_id: "" };
    return this.client.post<LoginResponse>("/api/v1/auth/login/google", body);
  }

  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    const body: RefreshTokenRequest = { refresh_token: refreshToken };
    return this.client.post<RefreshTokenResponse>("/api/v1/auth/refresh", body);
  }

  async validateToken(accessToken: string): Promise<ValidateTokenResponse> {
    const body: ValidateTokenRequest = { access_token: accessToken };
    return this.client.post<ValidateTokenResponse>("/api/v1/auth/validate", body);
  }

  async logout(refreshToken: string): Promise<void> {
    const body: RefreshTokenRequest = { refresh_token: refreshToken };
    await this.client.post<void>("/api/v1/auth/logout", body);
  }

  async getMe(): Promise<User> {
    const response = await this.client.get<{ success: boolean; data: User }>("/api/v1/auth/me");
    return response.data;
  }
}
