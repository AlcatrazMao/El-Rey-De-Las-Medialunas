type ConnectionListener = (isOnline: boolean) => void;

export class NetworkMonitor {
  private listeners: Set<ConnectionListener> = new Set();
  private _isOnline: boolean;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private healthCheckUrl: string | undefined;

  constructor(healthCheckUrl?: string) {
    this._isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    this.healthCheckUrl = healthCheckUrl;

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  onStatusChange(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleOnline = async (): Promise<void> => {
    const confirmed = await this.confirmOnline();
    if (confirmed && !this._isOnline) {
      this._isOnline = true;
      this.notifyListeners(true);
    }
  };

  private handleOffline = (): void => {
    if (this._isOnline) {
      this._isOnline = false;
      this.notifyListeners(false);
    }
  };

  private async confirmOnline(): Promise<boolean> {
    if (!this.healthCheckUrl) {
      return typeof navigator !== "undefined" ? navigator.onLine : true;
    }

    try {
      const response = await fetch(this.healthCheckUrl, {
        method: "HEAD",
        cache: "no-cache",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async checkNow(): Promise<boolean> {
    const wasOnline = this._isOnline;
    this._isOnline = await this.confirmOnline();

    if (this._isOnline !== wasOnline) {
      this.notifyListeners(this._isOnline);
    }

    return this._isOnline;
  }

  startPeriodicCheck(intervalMs: number = 30000): void {
    this.stopPeriodicCheck();
    this.checkInterval = setInterval(() => {
      void this.checkNow();
    }, intervalMs);
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval !== null) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private notifyListeners(isOnline: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(isOnline);
      } catch {
        // Silently ignore listener errors
      }
    }
  }

  destroy(): void {
    this.stopPeriodicCheck();
    this.listeners.clear();

    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
  }
}
