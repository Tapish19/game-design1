export interface Session {
  token: string;
  user_id: string;
  username?: string;
  exp: number;
  isexpired(nowSeconds: number): boolean;
}

export interface Match {
  match_id: string;
}

interface RpcTokenResponse {
  payload?: string;
}

interface RpcResponse {
  payload?: string;
}

export interface MatchData {
  op_code: number;
  data: Uint8Array;
}

export interface MatchmakerMatched {
  match_id?: string;
  token?: string;
}

export class Socket {
  private ws: WebSocket | null = null;
  private pendingMatchJoin:
    | {
        resolve: (match: Match) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | null = null;
  onmatchdata?: (data: MatchData) => void;
  onmatchmakermatched?: (matched: MatchmakerMatched) => void;
  ondisconnect?: () => void;

  constructor(
    private readonly host: string,
    private readonly port: string,
    private readonly useSsl: boolean,
  ) {}

  async connect(session: Session, createStatus = true): Promise<void> {
    const proto = this.useSsl ? "wss" : "ws";
    const url = `${proto}://${this.host}:${this.port}/ws?lang=en&status=${createStatus}&token=${encodeURIComponent(session.token)}`;
    this.ws = new WebSocket(url);
    this.ws.onclose = () => this.ondisconnect?.();
    this.ws.onmessage = (evt) => {
      const msg = JSON.parse(String(evt.data));

      if (msg.match) {
        if (this.pendingMatchJoin) {
          const pending = this.pendingMatchJoin;
          this.pendingMatchJoin = null;
          clearTimeout(pending.timer);
          pending.resolve({ match_id: msg.match.match_id });
        }
      }

      if (msg.error && this.pendingMatchJoin) {
        const pending = this.pendingMatchJoin;
        this.pendingMatchJoin = null;
        clearTimeout(pending.timer);
        pending.reject(new Error(msg.error.message ?? "Failed to join match"));
      }

      if (msg.match_data?.op_code !== undefined) {
        const opCode = Number(msg.match_data.op_code);
        if (Number.isNaN(opCode)) return;
        this.onmatchdata?.({
          op_code: opCode,
          data: b64ToBytes(msg.match_data.data ?? ""),
        });
      }
      if (msg.matchmaker_matched) {
        this.onmatchmakermatched?.(msg.matchmaker_matched);
      }
    };
    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error("Socket init failed"));
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error("Socket connection failed"));
    });
  }

  async joinMatch(matchIdOrToken: string): Promise<Match> {
    const isTokenJoin = isJwtToken(matchIdOrToken);
    if (this.pendingMatchJoin) {
      throw new Error("Already joining a match");
    }

    return new Promise<Match>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pendingMatchJoin) return;
        this.pendingMatchJoin = null;
        reject(new Error("Timed out while joining match"));
      }, 5000);

      this.pendingMatchJoin = { resolve, reject, timer };

      try {
        this.send({
          match_join: isTokenJoin ? { token: matchIdOrToken } : { match_id: matchIdOrToken },
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingMatchJoin = null;
        reject(err instanceof Error ? err : new Error("Failed to send join request"));
      }
    });
  }

  async sendMatchState(matchId: string, opCode: number, payload: string): Promise<void> {
    this.send({
      match_data_send: {
        match_id: matchId,
        op_code: opCode,
        data: bytesToB64(new TextEncoder().encode(payload)),
      },
    });
  }
  async addMatchmaker(mode: "classic" | "timed"): Promise<void> {
    this.send({
      matchmaker_add: {
        query: `properties.mode:${mode}`,
        min_count: 2,
        max_count: 2,
        string_properties: { mode },
        numeric_properties: {},
      },
    });
  }

  disconnect(): void {
    if (this.pendingMatchJoin) {
      const pending = this.pendingMatchJoin;
      this.pendingMatchJoin = null;
      clearTimeout(pending.timer);
      pending.reject(new Error("Socket disconnected"));
    }
    this.ws?.close();
    this.ws = null;
  }


  private send(payload: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Socket not connected");
    this.ws.send(JSON.stringify(payload));
  }
}

export class Client {
  public ssl = false;

  constructor(
    private readonly serverKey: string,
    private readonly host: string,
    private readonly port: string,
    private readonly useSsl: boolean,
  ) {}

  async authenticateDevice(deviceId: string, create = true, username?: string): Promise<Session> {
    const proto = this.useSsl ? "https" : "http";
    const res = await fetch(`${proto}://${this.host}:${this.port}/v2/account/authenticate/device?create=${create}&username=${encodeURIComponent(username ?? "")}`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${this.serverKey}:`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: deviceId }),
    });
    if (!res.ok) throw new Error(`Auth failed (${res.status})`);
    const data = await res.json();
    const parsed = parseJwt(data.token);
    return {
      token: data.token,
      user_id: parsed.uid,
      username: parsed.usn ?? username,
      exp: parsed.exp,
      isexpired(nowSeconds: number) {
        return nowSeconds >= parsed.exp;
      },
    };
  }

  async rpcHttpKey(httpKey: string, id: string, payload: string): Promise<RpcResponse> {
    const proto = this.useSsl ? "https" : "http";
    const res = await fetch(`${proto}://${this.host}:${this.port}/v2/rpc/${id}?http_key=${encodeURIComponent(httpKey)}&unwrap=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload || "{}",
    });
    if (!res.ok) throw new Error(`RPC ${id} failed (${res.status})`);
    return res.json();
  }

  async rpc(session: Session, id: string, payload: string): Promise<RpcTokenResponse> {
    const proto = this.useSsl ? "https" : "http";
    const res = await fetch(`${proto}://${this.host}:${this.port}/v2/rpc/${id}?unwrap=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.token}`,
      },
      body: payload || "{}",
    });
    if (!res.ok) throw new Error(`RPC ${id} failed (${res.status})`);
    return res.json();
  }

  createSocket(useSsl: boolean): Socket {
    return new Socket(this.host, this.port, useSsl);
  }
}

function parseJwt(token: string): Record<string, any> {
  const [, payload] = token.split(".");
  return JSON.parse(atob(payload));
}

function bytesToB64(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

function b64ToBytes(b64: string): Uint8Array {
  const raw = atob(b64 || "");
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function isJwtToken(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const decoded = JSON.parse(atob(payload));
    return typeof decoded === "object" && decoded !== null;
  } catch {
    return false;
  }
}
